'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { SystemHealth, WSMessage, WSCommandOutput, WSTaskResult, WebSocketMessage, TaskResult } from './types/api';

// Define WebSocket message types
interface WSExecuteCommand extends WebSocketMessage {
  type: 'execute_command';
  data: {
    systemId: string;
    command: string;
    args: string[];
  };
}

interface WebSocketContextType {
  isConnected: boolean;
  health: SystemHealth | null;
  lastError: string | null;
  commandOutputs: Map<string, WSCommandOutput>;
  taskResults: Map<string, WSTaskResult>;
  executeCommand: (systemId: string, command: string, args: string[]) => void;
  isHealthSocketOpen: boolean;
  isTaskSocketOpen: boolean;
  onCommandOutput: (callback: ((commandId: string, output: string, status: string) => void) | null) => void;
  onTaskResult: (callback: ((taskResult: WSTaskResult) => void) | null) => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
  health: null,
  lastError: null,
  commandOutputs: new Map(),
  taskResults: new Map(),
  executeCommand: () => {},
  isHealthSocketOpen: false,
  isTaskSocketOpen: false,
  onCommandOutput: () => {},
  onTaskResult: () => {}
});

const WS_PORT = 8080;
const RECONNECT_INTERVAL = 2000;
const MAX_RECONNECT_DELAY = 30000;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [commandOutputs, setCommandOutputs] = useState<Map<string, WSCommandOutput>>(new Map());
  const [taskResults, setTaskResults] = useState<Map<string, WSTaskResult>>(new Map());
  const [isHealthSocketOpen, setIsHealthSocketOpen] = useState(false);
  const [isTaskSocketOpen, setIsTaskSocketOpen] = useState(false);
  
  // Use refs to maintain stable references to callbacks
  const commandOutputCallbackRef = useRef<((commandId: string, output: string, status: string) => void) | null>(null);
  const taskResultCallbackRef = useRef<((taskResult: WSTaskResult) => void) | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const healthWs = useRef<WebSocket | null>(null);
  const taskWs = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const unmountingRef = useRef(false);

  const handleError = useCallback((event: Event) => {
    console.error('WebSocket error:', event);
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      console.log('Raw WebSocket message received:', event.data);
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log('Parsed WebSocket message:', message);

      switch (message.type) {
        case 'command_output':
          if (typeof message.data === 'object' && message.data !== null && 'commandId' in message.data) {
            const { commandId, output, status } = message.data as { commandId: string; output: string; status: string };
            console.log('Processing command output:', { commandId, output, status });
            if (commandOutputCallbackRef.current) {
              commandOutputCallbackRef.current(commandId, output, status);
            } else {
              console.warn('No command output callback registered');
            }
          } else {
            console.warn('Invalid command_output message format:', message.data);
          }
          break;
        case 'task_result':
          if (typeof message.data === 'object' && message.data !== null && 'taskId' in message.data) {
            const taskResult = message.data as WSTaskResult;
            console.log('Processing task result:', taskResult);
            if (taskResultCallbackRef.current) {
              // Try to find systemId from the task data if available
              if ('systemId' in message.data && typeof message.data.systemId === 'string') {
                taskResult.systemId = message.data.systemId;
              }
              taskResultCallbackRef.current(taskResult);
              // Update task results state
              setTaskResults(prev => {
                const newResults = new Map(prev);
                newResults.set(taskResult.taskId, taskResult);
                return newResults;
              });
            } else {
              console.warn('No task result callback registered');
            }
          } else {
            console.warn('Invalid task_result message format:', message.data);
          }
          break;
        default:
          console.log('Unhandled message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error, 'Raw data:', event.data);
    }
  }, []);

  const connect = useCallback((type: 'health' | 'task' = 'health') => {
    if (unmountingRef.current) return;

    const connectWithDelay = (delay: number) => {
      setTimeout(() => {
        const ws = new WebSocket(`ws://localhost:${WS_PORT}/ws/${type === 'health' ? 'health' : 'tasks'}`);
        
        if (type === 'health') {
          healthWs.current = ws;
        } else {
          taskWs.current = ws;
        }

        ws.onopen = () => {
          console.log(`${type} WebSocket connected, readyState:`, ws.readyState);
          if (type === 'health') {
            setIsHealthSocketOpen(true);
          } else {
            setIsTaskSocketOpen(true);
          }
          reconnectAttempts.current = 0;
          setLastError(null);
        };

        ws.onmessage = (event) => {
          console.log(`${type} WebSocket raw message:`, event.data);
          if (type === 'task') {
            handleMessage(event);
          } else {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'health') {
                setHealth(data.data);
              }
            } catch (error) {
              console.error('Error parsing health message:', error);
            }
          }
        };

        ws.onclose = (event) => {
          console.log(`${type} WebSocket closed, code:`, event.code, 'reason:', event.reason);
          if (type === 'health') {
            setIsHealthSocketOpen(false);
          } else {
            setIsTaskSocketOpen(false);
          }
          
          if (!event.wasClean && !unmountingRef.current) {
            const nextDelay = Math.min(
              RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts.current),
              MAX_RECONNECT_DELAY
            );
            
            reconnectAttempts.current++;
            console.log(`Reconnecting ${type} in ${nextDelay}ms (attempt ${reconnectAttempts.current})`);
            connectWithDelay(nextDelay);
          }
        };

        ws.onerror = (error) => {
          console.error(`${type} WebSocket error:`, error);
          handleError(error);
        };
      }, delay);
    };

    // Initial connection with a small delay
    connectWithDelay(1000);
  }, [handleMessage, handleError]);

  const executeCommand = useCallback((systemId: string, command: string, args: string[]) => {
    if (taskWs.current && taskWs.current.readyState === WebSocket.OPEN) {
      const message: WSExecuteCommand = {
        type: 'execute_command',
        data: { systemId, command, args }
      };
      console.log('Sending command through WebSocket:', message);
      taskWs.current.send(JSON.stringify(message));
    } else {
      console.error('Task WebSocket is not open. Current state:', taskWs.current?.readyState, 'Expected:', WebSocket.OPEN);
      // Attempt to reconnect if socket is closed
      if (!taskWs.current || taskWs.current.readyState === WebSocket.CLOSED) {
        console.log('Attempting to reconnect task WebSocket...');
        connect('task');
      }
    }
  }, [connect]);

  const handleCommandOutput = useCallback((callback: ((commandId: string, output: string, status: string) => void) | null) => {
    console.log('Setting command output callback:', callback ? 'function' : 'null');
    commandOutputCallbackRef.current = callback;
  }, []);

  const handleTaskResult = useCallback((callback: ((taskResult: WSTaskResult) => void) | null) => {
    console.log('Setting task result callback:', callback ? 'function' : 'null');
    taskResultCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    connect('health');
    connect('task');
    return () => {
      unmountingRef.current = true;
      console.log('Cleaning up WebSocket connections');
      if (healthWs.current) {
        console.log('Closing health WebSocket');
        healthWs.current.close();
      }
      if (taskWs.current) {
        console.log('Closing task WebSocket');
        taskWs.current.close();
      }
    };
  }, [connect]);

  useEffect(() => {
    setIsConnected(isHealthSocketOpen && isTaskSocketOpen);
  }, [isHealthSocketOpen, isTaskSocketOpen]);

  return (
    <WebSocketContext.Provider value={{
      isConnected,
      health,
      lastError,
      commandOutputs,
      taskResults,
      executeCommand,
      isHealthSocketOpen,
      isTaskSocketOpen,
      onCommandOutput: handleCommandOutput,
      onTaskResult: handleTaskResult
    }}>
      {children}
    </WebSocketContext.Provider>
  );
}
export function useWebSocket() {
  return useContext(WebSocketContext);
}

