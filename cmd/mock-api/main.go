package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

type Task struct {
	ID      string   `json:"id"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
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

func main() {
	log.SetPrefix("[Mock API] ")
	log.Printf("Starting Mock API server on :8080...")

	// Store task results
	var taskResults []TaskResult
	var taskResultsMutex sync.Mutex

	// Sample tasks that will be returned
	tasks := []Task{
		{
			ID:      "task1",
			Command: "cmd",
			Args:    []string{"/c", "echo", "Hello from Task 1"},
		},
		{
			ID:      "task2",
			Command: "powershell",
			Args:    []string{"-Command", "Get-Date"},
		},
	}

	// Handler for task list
	http.HandleFunc("/tasks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tasks)
	})

	// Handler for task results
	http.HandleFunc("/tasks/result", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var result TaskResult
		if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		taskResultsMutex.Lock()
		taskResults = append(taskResults, result)
		taskResultsMutex.Unlock()

		log.Printf("Received task result for task %s: success=%v, output=%s, error=%s",
			result.TaskID, result.Success, result.Output, result.Error)

		w.WriteHeader(http.StatusOK)
	})

	// Handler to view all results
	http.HandleFunc("/results", func(w http.ResponseWriter, r *http.Request) {
		taskResultsMutex.Lock()
		defer taskResultsMutex.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(taskResults)
	})

	log.Fatal(http.ListenAndServe(":8080", nil))
}
