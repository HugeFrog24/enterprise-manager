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
	tier2ProcessName = "tier2-core"
	checkInterval    = 5 * time.Second
)

func main() {
	log.SetPrefix("[Tier-1 Core] ")
	log.Printf("Starting Tier-1 Core Guardian...")

	// Get the executable directory
	exePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Failed to get executable path: %v", err)
	}
	baseDir := filepath.Dir(exePath)

	for {
		// Start tier2-core process
		tier2Path := filepath.Join(baseDir, fmt.Sprintf("%s.exe", tier2ProcessName))
		cmd := exec.Command(tier2Path)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr

		log.Printf("Starting Tier-2 Core process...")
		err := cmd.Start()
		if err != nil {
			log.Printf("Failed to start Tier-2 Core: %v", err)
			time.Sleep(checkInterval)
			continue
		}

		// Wait for the process to finish
		err = cmd.Wait()
		if err != nil {
			log.Printf("Tier-2 Core process ended with error: %v", err)
		} else {
			log.Printf("Tier-2 Core process ended normally")
		}

		// Wait before restarting
		time.Sleep(checkInterval)
	}
}
