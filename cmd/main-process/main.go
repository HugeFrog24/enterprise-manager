package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/cpu"
	"github.com/shirou/gopsutil/mem"
	"github.com/shirou/gopsutil/process"
	"golang.org/x/sys/windows/registry"
)

var (
	apiEndpoint     = getEnvOrDefault("API_ENDPOINT", "http://localhost:3000/api/tasks")
	systemsEndpoint = getEnvOrDefault("SYSTEMS_ENDPOINT", "http://localhost:3000/api/systems")
	wsPort          = getEnvOrDefault("WS_PORT", "8080")
	pollInterval    = time.Duration(getEnvIntOrDefault("POLL_INTERVAL_SECONDS", 30)) * time.Second
	maxRetries      = getEnvIntOrDefault("MAX_RETRIES", 3)
	retryInterval   = time.Duration(getEnvIntOrDefault("RETRY_INTERVAL_SECONDS", 5)) * time.Second
	systemId        = getEnvOrDefault("SYSTEM_ID", getMachineId())
	lastCPUUsage    float64
	proc            *process.Process
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
	failures     int
	maxFailures  int
	resetTimeout time.Duration
	lastFailure  time.Time
	mu           sync.RWMutex
}

func NewCircuitBreaker(maxFailures int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		maxFailures:  maxFailures,
		resetTimeout: resetTimeout,
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
}

func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
}

func (cb *CircuitBreaker) IsOpen() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	if cb.failures >= cb.maxFailures {
		if time.Since(cb.lastFailure) >= cb.resetTimeout {
			cb.failures = 0
			return false
		}
		return true
	}
	return false
}

// RetryWithExponentialBackoff implements exponential backoff for retries
func RetryWithExponentialBackoff(ctx context.Context, fn func() error) error {
	var err error
	for i := 0; i < maxRetries; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			if err = fn(); err == nil {
				return nil
			}

			backoffDuration := time.Duration(math.Pow(2, float64(i))) * retryInterval
			log.Printf("Attempt %d failed: %v. Retrying in %v...", i+1, err, backoffDuration)

			timer := time.NewTimer(backoffDuration)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
				continue
			}
		}
	}
	return fmt.Errorf("failed after %d attempts: %v", maxRetries, err)
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.LUTC)
	log.Printf("Using API endpoint: %s", apiEndpoint)
	log.Printf("Using Systems endpoint: %s", systemsEndpoint)
	log.Printf("System ID: %s", systemId)

	// Initialize the process object once
	var err error
	proc, err = process.NewProcess(int32(os.Getpid()))
	if err != nil {
		log.Printf("Error initializing process stats: %v", err)
	}
}

// healthCheck performs internal health checks
type SystemHealth struct {
	Tier1Uptime       float64 `json:"tier1Uptime"`
	Tier2Uptime       float64 `json:"tier2Uptime"`
	MainProcessUptime float64 `json:"mainProcessUptime"`
	LastHeartbeat     string  `json:"lastHeartbeat"`
	MemoryUsage       float64 `json:"memoryUsage"`
	CPUUsage          float64 `json:"cpuUsage"`
}

type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

var (
	startTime = time.Now()
	// Separate WebSocket client maps for health and task connections
	healthWsClients = make(map[*wsClient]bool)
	taskWsClients   = make(map[*wsClient]bool)
	broadcastMu     sync.RWMutex
)

func getCPUUsage() float64 {
	percentage, err := cpu.Percent(100*time.Millisecond, false)
	if err != nil {
		log.Printf("Error getting CPU usage: %v", err)
		return lastCPUUsage
	}

	if len(percentage) > 0 {
		lastCPUUsage = percentage[0]
		return percentage[0]
	}

	return lastCPUUsage
}

func getSystemHealth() (*SystemHealth, error) {
	// Get system memory stats
	v, err := mem.VirtualMemory()
	if err != nil {
		return nil, fmt.Errorf("failed to get memory stats: %v", err)
	}

	// Get system CPU usage
	cpuUsage := getCPUUsage()

	health := &SystemHealth{
		Tier1Uptime:       time.Since(startTime).Seconds(),
		Tier2Uptime:       time.Since(startTime).Seconds(),
		MainProcessUptime: time.Since(startTime).Seconds(),
		LastHeartbeat:     time.Now().UTC().Format(time.RFC3339),
		MemoryUsage:       v.UsedPercent,
		CPUUsage:          cpuUsage,
	}

	return health, nil
}

// WebSocket message types
type WSMessageType string

const (
	WSTypeHealth         WSMessageType = "health"
	WSTypeCommandOutput  WSMessageType = "command_output"
	WSTypeCommandStatus  WSMessageType = "command_status"
	WSTypeExecuteCommand WSMessageType = "execute_command"
	WSTypeTaskResult     WSMessageType = "task_result"
)

type WSMessage struct {
	Type WSMessageType `json:"type"`
	Data interface{}   `json:"data"`
}

type WSCommandOutput struct {
	CommandID string `json:"commandId"`
	Output    string `json:"output"`
	Status    string `json:"status,omitempty"`
	ExitCode  *int   `json:"exitCode,omitempty"`
}

type WSTaskResult struct {
	TaskID    string  `json:"taskId"`
	SystemID  string  `json:"systemId"`
	Status    string  `json:"status"`
	Output    string  `json:"output"`
	Error     *string `json:"error"`
	ExitCode  int     `json:"exitCode"`
	StartTime string  `json:"startTime"`
	EndTime   string  `json:"endTime"`
}

type WSExecuteCommand struct {
	SystemID string   `json:"systemId"`
	Command  string   `json:"command"`
	Args     []string `json:"args"`
}

// activeCommands tracks running commands and their output channels
var (
	activeCommands   = make(map[string]chan string)
	activeCommandsMu sync.RWMutex
)

// broadcastToWebSocket sends a message to all connected WebSocket clients
func broadcastToWebSocket(msg WSMessage, clients map[*wsClient]bool) {
	// Get a snapshot of current clients under read lock
	broadcastMu.RLock()
	activeClients := make([]*wsClient, 0, len(clients))
	for client := range clients {
		activeClients = append(activeClients, client)
	}
	broadcastMu.RUnlock()

	// Send messages to each client with their own mutex
	for _, client := range activeClients {
		client.mu.Lock()
		err := client.conn.WriteJSON(msg)
		client.mu.Unlock()

		if err != nil {
			log.Printf("Failed to send message to client: %v", err)
			// Remove failed client under write lock
			broadcastMu.Lock()
			delete(clients, client)
			broadcastMu.Unlock()
			client.conn.Close()
		}
	}
}

// broadcastCommandOutput sends command output to all connected WebSocket clients
func broadcastCommandOutput(commandID, output string, status string, exitCode *int) {
	msg := WSMessage{
		Type: WSTypeCommandOutput,
		Data: WSCommandOutput{
			CommandID: commandID,
			Output:    output,
			Status:    status,
			ExitCode:  exitCode,
		},
	}
	broadcastToWebSocket(msg, taskWsClients)
}

func executeTaskWithWebSocket(task Task, systemId string) error {
	// Create output buffer to store complete output
	var outputBuffer bytes.Buffer
	startTime := time.Now().UTC().Format(time.RFC3339)

	// Send initial task status
	initialResult := TaskResult{
		TaskID:    task.ID,
		Status:    "running",
		Output:    "",
		Error:     nil,
		ExitCode:  0,
		StartTime: startTime,
		EndTime:   "",
	}
	broadcastTaskResult(initialResult, systemId)

	// Create output channel for this command
	activeCommandsMu.Lock()
	outputChan := make(chan string, 100)
	activeCommands[task.ID] = outputChan
	activeCommandsMu.Unlock()

	// Cleanup function
	defer func() {
		activeCommandsMu.Lock()
		delete(activeCommands, task.ID)
		close(outputChan)
		activeCommandsMu.Unlock()
	}()

	// Notify start
	broadcastCommandOutput(task.ID, "", "running", nil)

	// Create command
	var cmd *exec.Cmd
	if task.Command == "screenshot" {
		// Handle screenshot command
		imgPath, err := takeScreenshot()
		if err != nil {
			errMsg := err.Error()
			result := TaskResult{
				TaskID:    task.ID,
				Status:    "failed",
				Output:    errMsg,
				Error:     &errMsg,
				ExitCode:  1,
				StartTime: startTime,
				EndTime:   time.Now().UTC().Format(time.RFC3339),
			}
			broadcastTaskResult(result, systemId)
			broadcastCommandOutput(task.ID, errMsg, "failed", new(int))
			return err
		}
		successMsg := fmt.Sprintf("Screenshot saved: %s", imgPath)
		result := TaskResult{
			TaskID:    task.ID,
			Status:    "completed",
			Output:    successMsg,
			ExitCode:  0,
			StartTime: startTime,
			EndTime:   time.Now().UTC().Format(time.RFC3339),
		}
		broadcastTaskResult(result, systemId)
		broadcastCommandOutput(task.ID, successMsg, "completed", new(int))
		return nil
	} else if isPowerShellCommand(task.Command) {
		args := append([]string{"-Command"}, task.Command)
		if len(task.Args) > 0 {
			args = append(args, task.Args...)
		}
		cmd = exec.Command("powershell.exe", args...)
	} else {
		cmd = exec.Command(task.Command, task.Args...)
	}

	// Set up output pipe
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		errMsg := err.Error()
		result := TaskResult{
			TaskID:    task.ID,
			Status:    "failed",
			Output:    errMsg,
			Error:     &errMsg,
			ExitCode:  1,
			StartTime: startTime,
			EndTime:   time.Now().UTC().Format(time.RFC3339),
		}
		broadcastTaskResult(result, systemId)
		broadcastCommandOutput(task.ID, errMsg, "failed", new(int))
		return err
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		errMsg := err.Error()
		result := TaskResult{
			TaskID:    task.ID,
			Status:    "failed",
			Output:    errMsg,
			Error:     &errMsg,
			ExitCode:  1,
			StartTime: startTime,
			EndTime:   time.Now().UTC().Format(time.RFC3339),
		}
		broadcastTaskResult(result, systemId)
		broadcastCommandOutput(task.ID, errMsg, "failed", new(int))
		return err
	}

	// Start command
	if err := cmd.Start(); err != nil {
		errMsg := err.Error()
		result := TaskResult{
			TaskID:    task.ID,
			Status:    "failed",
			Output:    errMsg,
			Error:     &errMsg,
			ExitCode:  1,
			StartTime: startTime,
			EndTime:   time.Now().UTC().Format(time.RFC3339),
		}
		broadcastTaskResult(result, systemId)
		broadcastCommandOutput(task.ID, errMsg, "failed", new(int))
		return err
	}

	// Read output in background
	go func() {
		scanner := bufio.NewScanner(io.MultiReader(stdout, stderr))
		for scanner.Scan() {
			output := scanner.Text()
			outputBuffer.WriteString(output + "\n")
			broadcastCommandOutput(task.ID, output, "running", nil)
		}
	}()

	// Wait for command to complete
	err = cmd.Wait()
	exitCode := 0
	var errorStr *string
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		errMsg := err.Error()
		errorStr = &errMsg
		broadcastCommandOutput(task.ID, err.Error(), "failed", &exitCode)
	} else {
		broadcastCommandOutput(task.ID, "", "completed", &exitCode)
	}

	// Send final task result through WebSocket
	status := "completed"
	if exitCode != 0 {
		status = "failed"
	}
	result := TaskResult{
		TaskID:    task.ID,
		Status:    status,
		Output:    outputBuffer.String(),
		Error:     errorStr,
		ExitCode:  exitCode,
		StartTime: startTime,
		EndTime:   time.Now().UTC().Format(time.RFC3339),
	}
	broadcastTaskResult(result, systemId)

	if exitCode != 0 {
		return fmt.Errorf("command failed with exit code %d", exitCode)
	}

	return nil
}

func handleTaskWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &wsClient{
		conn: conn,
	}

	// Register this connection
	broadcastMu.Lock()
	taskWsClients[client] = true
	broadcastMu.Unlock()

	defer func() {
		broadcastMu.Lock()
		delete(taskWsClients, client)
		broadcastMu.Unlock()
		conn.Close()
	}()

	// Main message handling loop
	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			return
		}

		if messageType == websocket.TextMessage {
			var msg WSMessage
			if err := json.Unmarshal(p, &msg); err != nil {
				log.Printf("Error unmarshaling message: %v", err)
				continue
			}

			switch msg.Type {
			case WSTypeExecuteCommand:
				var cmd WSExecuteCommand
				data, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Error marshaling command data: %v", err)
					continue
				}
				if err := json.Unmarshal(data, &cmd); err != nil {
					log.Printf("Error unmarshaling command: %v", err)
					continue
				}

				// Generate command ID
				commandID := uuid.New().String()

				// Create and execute task
				task := Task{
					ID:      commandID,
					Command: cmd.Command,
					Args:    cmd.Args,
				}

				go func() {
					if err := executeTaskWithWebSocket(task, cmd.SystemID); err != nil {
						log.Printf("Error executing command: %v", err)
					}
				}()
			}
		}
	}
}

func handleHealthWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &wsClient{
		conn: conn,
	}

	// Register this connection
	broadcastMu.Lock()
	healthWsClients[client] = true
	broadcastMu.Unlock()

	defer func() {
		broadcastMu.Lock()
		delete(healthWsClients, client)
		broadcastMu.Unlock()
		conn.Close()
	}()

	// Start health check ticker
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Health check goroutine
	go func() {
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				health, err := getSystemHealth()
				if err != nil {
					log.Printf("Failed to get health: %v", err)
					continue
				}

				msg := WSMessage{
					Type: WSTypeHealth,
					Data: health,
				}

				if err := conn.WriteJSON(msg); err != nil {
					log.Printf("Failed to send health update: %v", err)
					return
				}
			}
		}
	}()

	// Main message handling loop
	for {
		messageType, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			return
		}

		if messageType != websocket.TextMessage {
			continue
		}
	}
}

type Task struct {
	ID      string   `json:"id"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

type TaskResult struct {
	TaskID    string  `json:"taskId"`
	Status    string  `json:"status"`
	Output    string  `json:"output"`
	Error     *string `json:"error"`
	ExitCode  int     `json:"exitCode"`
	StartTime string  `json:"startTime"`
	EndTime   string  `json:"endTime"`
}

// TasksResponse wraps the tasks array in the API response
type TasksResponse struct {
	Data []Task `json:"data"`
}

func broadcastTaskResult(result TaskResult, systemId string) {
	msg := WSMessage{
		Type: WSTypeTaskResult,
		Data: WSTaskResult{
			TaskID:    result.TaskID,
			SystemID:  systemId,
			Status:    result.Status,
			Output:    result.Output,
			Error:     result.Error,
			ExitCode:  result.ExitCode,
			StartTime: result.StartTime,
			EndTime:   result.EndTime,
		},
	}
	broadcastToWebSocket(msg, taskWsClients)
}

func fetchTasks() ([]Task, error) {
	tasksURL := fmt.Sprintf("%s?systemId=%s", apiEndpoint, systemId)
	log.Printf("Fetching tasks from: %s", tasksURL)
	req, err := http.NewRequest("GET", tasksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("User-Agent", "Enterprise-Manager-Client/1.0")
	req.Header.Set("Accept", "application/json")

	// Debug request
	reqDump, err := httputil.DumpRequestOut(req, true)
	if err == nil {
		log.Printf("Request:\n%s", string(reqDump))
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tasks: %v", err)
	}
	defer resp.Body.Close()

	// Debug response
	respDump, err := httputil.DumpResponse(resp, true)
	if err == nil {
		log.Printf("Response:\n%s", string(respDump))
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	var response TasksResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to parse tasks: %v", err)
	}

	return response.Data, nil
}

func takeScreenshot() (string, error) {
	// Create a temporary file for the screenshot
	tmpfile, err := os.CreateTemp("", "screenshot-*.png")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %v", err)
	}
	tmpfilePath := tmpfile.Name()
	tmpfile.Close() // Close it so PowerShell can write to it

	// Use PowerShell to take a screenshot
	psScript := `
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        
        function Take-Screenshot {
            param($path)
            
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            
            $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
            
            $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
            
            $graphics.Dispose()
            $bitmap.Dispose()
            
            Write-Host "Screenshot saved to: $path"
        }
        
        Take-Screenshot -path '` + tmpfilePath + `'
    `

	// Execute PowerShell script
	cmd := exec.Command("powershell", "-Command", psScript)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to take screenshot: %v, output: %s", err, output)
	}

	// Verify the file exists and has content
	if info, err := os.Stat(tmpfilePath); err != nil {
		return "", fmt.Errorf("screenshot file not found: %v", err)
	} else if info.Size() == 0 {
		return "", fmt.Errorf("screenshot file is empty")
	}

	// Read the file and encode to base64
	imageBytes, err := os.ReadFile(tmpfilePath)
	if err != nil {
		return "", fmt.Errorf("failed to read screenshot: %v", err)
	}

	// Clean up
	os.Remove(tmpfilePath)

	if len(imageBytes) == 0 {
		return "", fmt.Errorf("no image data read from file")
	}

	base64Image := base64.StdEncoding.EncodeToString(imageBytes)
	if base64Image == "" {
		return "", fmt.Errorf("failed to encode image to base64")
	}

	return base64Image, nil
}

// isPowerShellCommand checks if a command is a PowerShell cmdlet
func isPowerShellCommand(command string) bool {
	// Run Get-Command to check if the command exists in PowerShell
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", fmt.Sprintf("Get-Command %s -ErrorAction SilentlyContinue", command))
	err := cmd.Run()
	return err == nil
}

func executeTask(task Task) error {
	return executeTaskWithWebSocket(task, systemId)
}

func registerSystem() error {
	health, err := getSystemHealth()
	if err != nil {
		return fmt.Errorf("failed to get system health: %v", err)
	}

	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	system := struct {
		ID       string       `json:"id"`
		Name     string       `json:"name"`
		Hostname string       `json:"hostname"`
		HostInfo string       `json:"hostInfo"`
		Health   SystemHealth `json:"health"`
	}{
		ID:       systemId,
		Name:     fmt.Sprintf("System (%s)", runtime.GOOS),
		Hostname: hostname,
		HostInfo: fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		Health:   *health,
	}

	systemJSON, err := json.Marshal(system)
	if err != nil {
		return fmt.Errorf("failed to marshal system info: %v", err)
	}

	registerEndpoint := fmt.Sprintf("%s/register", systemsEndpoint)
	resp, err := http.Post(registerEndpoint, "application/json", bytes.NewBuffer(systemJSON))
	if err != nil {
		return fmt.Errorf("failed to register system: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code when registering system: %d", resp.StatusCode)
	}

	log.Printf("Successfully registered system with ID: %s", systemId)
	return nil
}

func main() {
	log.SetPrefix("[Main Process] ")
	log.Printf("Starting Main Process on %s...", runtime.GOOS)

	// Setup context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Create error channel for critical errors
	errChan := make(chan error, 1)

	// Register system on startup
	if err := registerSystem(); err != nil {
		log.Printf("Failed to register system: %v", err)
	}

	// Start WebSocket server
	http.HandleFunc("/ws/health", handleHealthWebSocket)
	http.HandleFunc("/ws/tasks", handleTaskWebSocket)

	go func() {
		log.Printf("Starting WebSocket server on port %s...", wsPort)
		if err := http.ListenAndServe(":"+wsPort, nil); err != nil {
			log.Printf("WebSocket server error: %v", err)
			errChan <- fmt.Errorf("WebSocket server error: %v", err)
		}
	}()

	// Start registration refresh loop
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := registerSystem(); err != nil {
					log.Printf("Failed to refresh system registration: %v", err)
				}
			}
		}
	}()

	// Start task polling loop
	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tasks, err := fetchTasks()
				if err != nil {
					log.Printf("Failed to fetch tasks: %v", err)
					continue
				}

				if len(tasks) > 0 {
					log.Printf("Fetched %d tasks", len(tasks))
				}

				for _, task := range tasks {
					go func(task Task) {
						if err := executeTask(task); err != nil {
							log.Printf("Error executing task: %v", err)
						}
					}(task)
				}
			}
		}
	}()

	// Start health check loop
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
				if err := healthCheck(); err != nil {
					log.Printf("Health check failed: %v", err)
					time.Sleep(10 * time.Second)
					continue
				}

				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
					continue
				}
			}
		}
	}()

	// Handle shutdown
	select {
	case sig := <-sigChan:
		log.Printf("Received signal: %v", sig)
		cancel()
	case err := <-errChan:
		log.Printf("Critical error: %v", err)
		cancel()
	}

	// Graceful shutdown
	log.Println("Initiating graceful shutdown...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Wait for ongoing tasks to complete or timeout
	select {
	case <-shutdownCtx.Done():
		log.Println("Shutdown timeout reached, forcing exit")
	case <-ctx.Done():
		log.Println("Shutdown complete")
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getMachineId retrieves a stable system identifier
func getMachineId() string {
	if runtime.GOOS == "windows" {
		// Try to get Windows MachineGUID from registry
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE)
		if err == nil {
			defer k.Close()

			guid, _, err := k.GetStringValue("MachineGuid")
			if err == nil && guid != "" {
				return fmt.Sprintf("win-%s", strings.ToLower(guid))
			}
		}
	}

	// Fallback for non-Windows systems or if registry access fails
	hostname, err := os.Hostname()
	if err != nil {
		hostname = fmt.Sprintf("unknown-%d", os.Getpid())
	}
	return fmt.Sprintf("sys-%s-%s-%d", hostname, runtime.GOOS, time.Now().Unix())
}

func getEnvIntOrDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// healthCheck performs a health check of the system
func healthCheck() error {
	health, err := getSystemHealth()
	if err != nil {
		return fmt.Errorf("failed to get system health: %v", err)
	}

	// Broadcast health status to all connected WebSocket clients
	msg := WSMessage{
		Type: WSTypeHealth,
		Data: health,
	}

	broadcastToWebSocket(msg, healthWsClients)
	return nil
}
