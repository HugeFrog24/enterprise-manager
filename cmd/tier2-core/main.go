package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	mainProcessName = "main-process"
	checkInterval   = 5 * time.Second
)

func main() {
	log.SetPrefix("[Tier-2 Core] ")
	log.Printf("Starting Tier-2 Core Monitor...")

	// Get the executable directory
	exePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Failed to get executable path: %v", err)
	}
	baseDir := filepath.Dir(exePath)

	for {
		// Start main process
		mainPath := filepath.Join(baseDir, fmt.Sprintf("%s.exe", mainProcessName))
		cmd := exec.Command(mainPath)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr

		log.Printf("Starting Main Process...")
		err := cmd.Start()
		if err != nil {
			log.Printf("Failed to start Main Process: %v", err)
			time.Sleep(checkInterval)
			continue
		}

		// Wait for the process to finish
		err = cmd.Wait()
		if err != nil {
			log.Printf("Main Process ended with error: %v", err)
		} else {
			log.Printf("Main Process ended normally")
		}

		// Wait before restarting
		time.Sleep(checkInterval)
	}
}
