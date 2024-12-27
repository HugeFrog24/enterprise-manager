package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

const (
	apiEndpoint   = "http://localhost:8080/tasks" // Example API endpoint
	pollInterval  = 30 * time.Second
	maxRetries    = 3
	retryInterval = 5 * time.Second
)

type Task struct {
	ID      string   `json:"id"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

func fetchTasks() ([]Task, error) {
	resp, err := http.Get(apiEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tasks: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	var tasks []Task
	if err := json.Unmarshal(body, &tasks); err != nil {
		return nil, fmt.Errorf("failed to parse tasks: %v", err)
	}

	return tasks, nil
}

type TaskResult struct {
	TaskID    string    `json:"task_id"`
	Success   bool      `json:"success"`
	Output    string    `json:"output"`
	Error     string    `json:"error,omitempty"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	ExitCode  int       `json:"exit_code"`
	HostInfo  string    `json:"host_info"`
}

func reportTaskResult(result TaskResult) error {
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("failed to marshal result: %v", err)
	}

	resultEndpoint := "http://localhost:8080/tasks/result"
	resp, err := http.Post(resultEndpoint, "application/json", bytes.NewBuffer(resultJSON))
	if err != nil {
		return fmt.Errorf("failed to report result: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code when reporting result: %d", resp.StatusCode)
	}

	return nil
}

func executeTask(task Task) error {
	log.Printf("Executing task %s: %s %v", task.ID, task.Command, task.Args)

	result := TaskResult{
		TaskID:    task.ID,
		StartTime: time.Now(),
		HostInfo:  fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
	}

	// Security check: Only allow specific commands
	allowedCommands := map[string]bool{
		"powershell": true,
		"cmd":        true,
		"wmic":       true,
		// Add more allowed commands as needed
	}

	if !allowedCommands[task.Command] {
		result.Success = false
		result.Error = fmt.Sprintf("command not allowed: %s", task.Command)
		result.EndTime = time.Now()
		if err := reportTaskResult(result); err != nil {
			log.Printf("Failed to report task result: %v", err)
		}
		return fmt.Errorf("%s", result.Error)
	}

	// Create command with output capture
	cmd := exec.Command(task.Command, task.Args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = io.MultiWriter(os.Stdout, &stdout)
	cmd.Stderr = io.MultiWriter(os.Stderr, &stderr)

	err := cmd.Run()
	result.EndTime = time.Now()
	result.Output = stdout.String()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		}
		result.Error = fmt.Sprintf("%v\n%s", err, stderr.String())
		result.Success = false
	} else {
		result.Success = true
		result.ExitCode = 0
	}

	// Report result regardless of success/failure
	if reportErr := reportTaskResult(result); reportErr != nil {
		log.Printf("Failed to report task result: %v", reportErr)
	}

	if err != nil {
		return fmt.Errorf("task execution failed: %v", err)
	}
	return nil
}

func main() {
	log.SetPrefix("[Main Process] ")
	log.Printf("Starting Main Process on %s...", runtime.GOOS)

	for {
		var tasks []Task
		var err error

		// Retry logic for fetching tasks
		for i := 0; i < maxRetries; i++ {
			tasks, err = fetchTasks()
			if err == nil {
				break
			}
			log.Printf("Attempt %d: Failed to fetch tasks: %v", i+1, err)
			if i < maxRetries-1 {
				time.Sleep(retryInterval)
			}
		}

		if err != nil {
			log.Printf("Failed to fetch tasks after %d attempts", maxRetries)
			time.Sleep(pollInterval)
			continue
		}

		// Execute each task
		for _, task := range tasks {
			if err := executeTask(task); err != nil {
				log.Printf("Failed to execute task %s: %v", task.ID, err)
			} else {
				log.Printf("Successfully executed task %s", task.ID)
			}
		}

		time.Sleep(pollInterval)
	}
}
