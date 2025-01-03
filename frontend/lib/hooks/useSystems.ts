import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { ApiClient } from '../api/client';
import type { System, Task, CommandResult, WSTaskResult } from '../types/api';
import { useWebSocket } from '../websocket';
import { addTask, updateTaskResult, getSystemTasks, clearSystemTasks, getTasks } from '../store/tasks';

// Type guard for ApiError
const isApiError = (error: unknown): error is Error & { status?: number } => {
  return error instanceof Error && 'status' in error;
};

const fetcher = async (url: string): Promise<System[]> => {
  const apiClient = ApiClient.getInstance();
  if (url === '/systems') {
    return apiClient.getSystems();
  }
  throw new Error(`Unknown URL: ${url}`);
};

export function useSystems() {
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Record<string, Task>>({});
  const [commandResults, setCommandResults] = useState<Record<string, CommandResult[]>>({});
  const MAX_RESULTS = 10;
  const { onCommandOutput, onTaskResult } = useWebSocket();

  // Fetch systems with SWR
  const { data: systems = [], mutate: mutateSystems } = useSWR<System[]>(
    '/systems',
    fetcher,
    {
      refreshInterval: 2000,
      dedupingInterval: 1000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  );

  // Load tasks for each system on initial load
  useEffect(() => {
    if (systems.length > 0) {
      Promise.all(
        systems.map(async (system) => {
          try {
            await getTasks(system.id);
          } catch (error) {
            console.error(`Error loading tasks for system ${system.id}:`, error);
          }
        })
      );
    }
  }, [systems]);

  // Combine systems with their results
  const systemsWithResults = systems.map(system => ({
    ...system,
    commandResults: getSystemTasks(system.id)
  }));

  const handleCommandOutputUpdate = useCallback((commandId: string, output: string, status: string) => {
    // Queue the update for the next tick to avoid state updates during render
    Promise.resolve().then(() => {
      // First get the systemId from pendingTasks
      setPendingTasks(prevTasks => {
        const task = Object.values(prevTasks).find(t => t.id === commandId);
        if (task?.systemId) {
          // Update command results in a separate state update
          setCommandResults(prevResults => {
            const updatedResults = { ...prevResults };
            const systemResults = updatedResults[task.systemId] || [];
            const resultIndex = systemResults.findIndex(r => r.taskId === commandId);
            
            if (resultIndex !== -1) {
              // Update existing result
              const updatedResult = {
                ...systemResults[resultIndex],
                output: systemResults[resultIndex].output + output + '\n',
                status: status as CommandResult['status']
              };
              updatedResults[task.systemId] = [
                ...systemResults.slice(0, resultIndex),
                updatedResult,
                ...systemResults.slice(resultIndex + 1)
              ];
            } else {
              // Create new result
              const newResult: CommandResult = {
                taskId: commandId,
                status: 'running',
                output: output + '\n',
                error: null,
                exitCode: null,
                startTime: new Date().toISOString(),
                endTime: null
              };
              updatedResults[task.systemId] = [newResult, ...systemResults].slice(0, MAX_RESULTS);
            }
            return updatedResults;
          });
        }
        return prevTasks; // Don't modify pendingTasks
      });
    });
  }, [MAX_RESULTS]);

  const handleTaskResultUpdate = useCallback((taskResult: WSTaskResult) => {
    if (!taskResult) return;
    
    console.log('Received task result update:', taskResult);
    
    // Queue the updates for the next tick
    Promise.resolve().then(async () => {
      try {
        // Use systemId from taskResult if available
        let systemId = taskResult.systemId;

        // If not available, try to find it in pendingTasks
        if (!systemId) {
          setPendingTasks(prevTasks => {
            const task = Object.values(prevTasks).find(t => t.id === taskResult.taskId);
            if (task) {
              systemId = task.systemId;
            }
            return prevTasks;
          });
        }

        // If still no systemId, check if it's in the task result
        if (!systemId && 'systemId' in taskResult && typeof taskResult.systemId === 'string') {
          systemId = taskResult.systemId;
        }

        if (!systemId) {
          console.warn('Could not find system ID for task:', taskResult.taskId);
          return;
        }

        console.log('Found systemId:', systemId);

        // Update task result in storage first
        await updateTaskResult(systemId, taskResult.taskId, taskResult);

        // Update command results
        setCommandResults(prevResults => {
          const updatedResults = { ...prevResults };
          const systemResults = updatedResults[systemId!] || [];
          const resultIndex = systemResults.findIndex(r => r.taskId === taskResult.taskId);
          
          if (resultIndex !== -1) {
            // Update existing result
            const updatedResult = {
              ...systemResults[resultIndex],
              ...taskResult,
              status: taskResult.status // Ensure status is explicitly set
            };
            updatedResults[systemId!] = [
              ...systemResults.slice(0, resultIndex),
              updatedResult,
              ...systemResults.slice(resultIndex + 1)
            ];
          } else {
            // Create new result
            updatedResults[systemId!] = [taskResult, ...systemResults].slice(0, MAX_RESULTS);
          }
          return updatedResults;
        });

        // Update pending tasks
        setPendingTasks(prevTasks => {
          const newTasks = { ...prevTasks };
          if (taskResult.status === 'completed' || taskResult.status === 'failed') {
            delete newTasks[taskResult.taskId];
          } else if (taskResult.taskId in newTasks) {
            newTasks[taskResult.taskId] = {
              ...newTasks[taskResult.taskId],
              status: taskResult.status
            };
          }
          return newTasks;
        });

        // Trigger a re-render
        await mutateSystems();
      } catch (error) {
        console.error('Error updating task result:', error);
        setError('Failed to update task result');
      }
    });
  }, [MAX_RESULTS, mutateSystems]);

  // Register callbacks when the hook mounts
  useEffect(() => {
    console.log('Setting up WebSocket callbacks');

    // Register the callbacks immediately
    if (onCommandOutput) {
      console.log('Registering command output callback');
      onCommandOutput(handleCommandOutputUpdate);
    }
    if (onTaskResult) {
      console.log('Registering task result callback');
      onTaskResult(handleTaskResultUpdate);
    }

    // Only clean up on unmount
    return () => {
      console.log('Cleaning up WebSocket callbacks');
      if (onCommandOutput) onCommandOutput(null);
      if (onTaskResult) onTaskResult(null);
    };
  }, [onCommandOutput, onTaskResult]);

  return {
    systems: systemsWithResults,
    selectedSystem,
    setSelectedSystem,
    loading: !systems,
    error,
    createTask: async (systemId: string, command: string, args: string[] = []) => {
      try {
        console.log('Creating task:', { systemId, command, args });
        const apiClient = ApiClient.getInstance();
        const task = await apiClient.createTask(systemId, command, args);
        console.log('Task created:', task);

        // Add task to storage first, including systemId
        const savedTask = await addTask({
          ...task,
          systemId, // Include systemId here
          status: 'pending',
          output: '',
          error: null,
          exitCode: null,
          startTime: new Date().toISOString(),
          endTime: null
        });
        if (!savedTask) {
          throw new Error('Failed to save task');
        }
        console.log('Task saved to storage:', savedTask);

        // Add to pending tasks
        setPendingTasks(prev => ({
          ...prev,
          [task.id]: savedTask // Use the saved task object
        }));

        // Add initial command result
        setCommandResults(prev => {
          const updatedResults = { ...prev };
          const systemResults = updatedResults[systemId] || [];
          const newResult: CommandResult = {
            taskId: task.id,
            status: 'pending',
            output: '',
            error: null,
            exitCode: null,
            startTime: new Date().toISOString(),
            endTime: null
          };
          updatedResults[systemId] = [newResult, ...systemResults].slice(0, MAX_RESULTS);
          return updatedResults;
        });

        // Trigger a re-render
        await mutateSystems();
        console.log('Systems mutated after task creation');

        return savedTask; // Return the saved task object
      } catch (err) {
        console.error('Error creating task:', err);
        const errorMessage = isApiError(err)
          ? `Failed to create task: ${err.message}`
          : 'Failed to create task';
        setError(errorMessage);
        throw err;
      }
    },
    deleteSystem: async (systemId: string) => {
      try {
        const apiClient = ApiClient.getInstance();
        await apiClient.deleteSystem(systemId);
        mutateSystems();
      } catch (err) {
        const errorMessage = isApiError(err)
          ? `Failed to delete system: ${err.message}`
          : 'Failed to delete system';
        setError(errorMessage);
        throw err;
      }
    },
    clearCommandHistory: async (systemId: string) => {
      await clearSystemTasks(systemId);
      mutateSystems();
      return true;
    }
  };
}
