'use client';

import React, { FC, useState } from 'react';
import { useSystems } from '../lib/hooks/useSystems';
import { useWebSocket } from '../lib/websocket';
import { SystemHealth } from '../components/SystemHealth';
import { CommandResults } from '../components/CommandResults';
import { TrashIcon, CameraIcon } from '@heroicons/react/24/outline';
import { v4 as uuid } from 'uuid';
import { saveTask } from '@/lib/store/tasks';

const Home: FC = () => {
  const { systems, loading, error, deleteSystem, clearCommandHistory } = useSystems();
  const { executeCommand } = useWebSocket();
  const [selectedCommand, setSelectedCommand] = useState<string>('');
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const handleExecuteCommand = async (systemId: string) => {
    if (!selectedCommand.trim()) return;
    
    try {
      // Split command string into command and args
      const parts = selectedCommand.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
      const parsedParts = parts.map(part => {
        // Remove surrounding quotes if present
        if ((part.startsWith('"') && part.endsWith('"')) || 
            (part.startsWith("'") && part.endsWith("'"))) {
          return part.slice(1, -1);
        }
        return part;
      });

      // Create a new task
      const task: Task = {
        id: uuid(),
        systemId,
        command: parsedParts[0],
        args: parsedParts.slice(1),
        status: 'pending',
        output: '',
        error: null,
        exitCode: null,
        startTime: new Date().toISOString(),
        endTime: null
      };

      // Save the task
      const savedTask = await saveTask(task);
      if (!savedTask) {
        throw new Error('Failed to save task');
      }

      // Execute the command through websocket
      executeCommand(systemId, task.command, task.args);
      
      setSelectedCommand('');
      setNotification({
        message: 'Command sent successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Error executing command:', error);
      setNotification({
        message: 'Failed to execute command',
        type: 'error'
      });
    }
  };

  const handleClearHistory = async (systemId: string) => {
    try {
      await clearCommandHistory(systemId);
      setNotification({
        message: 'Command history cleared successfully',
        type: 'success'
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({
        message: err instanceof Error ? err.message : 'Failed to clear command history',
        type: 'error'
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
    </div>
  );

  if (error) return (
    <div className="p-8 bg-red-50 text-red-500">
      Error: {error}
    </div>
  );

  return (
    <main className="min-h-screen p-8 bg-gray-50 relative">
      {notification && (
        <div 
          className={`fixed bottom-4 right-4 px-4 py-2 rounded shadow ${
            notification.type === 'success' 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}
        >
          {notification.message}
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Enterprise Manager</h1>
        
        <div className="grid gap-8">
          {systems.map((system) => (
            <div 
              key={system.id}
              className="mb-8 p-6 bg-white rounded-lg shadow-md"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">{system.name}</h2>
                <button
                  onClick={() => deleteSystem(system.id)}
                  className="text-red-600 hover:text-red-800"
                  title="Delete System"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
              
              <div className="mt-2 text-gray-600">
                Host: {system.hostInfo}
              </div>
              
              <div className="mt-2 text-gray-600">
                Last heartbeat: {new Date(system.lastHeartbeat).toLocaleString()}
              </div>

              {system.health && (
                <SystemHealth 
                  health={system.health} 
                  system={system} 
                  lastHeartbeat={system.lastHeartbeat || new Date().toISOString()} 
                />
              )}
              
              <div className="mt-6">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedCommand}
                    onChange={(e) => setSelectedCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleExecuteCommand(system.id);
                      }
                    }}
                    placeholder="Enter command..."
                    className="flex-1 p-2 border rounded"
                  />
                  <button
                    onClick={() => handleExecuteCommand(system.id)}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Execute Command
                  </button>
                  <button
                    onClick={() => {
                      setSelectedCommand('screenshot');
                      handleExecuteCommand(system.id);
                    }}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-2"
                  >
                    <CameraIcon className="h-5 w-5" />
                    Screenshot
                  </button>
                </div>
              </div>
              
              {system.commandResults && system.commandResults.length > 0 && (
                <div>
                  <div className="flex justify-between items-center mt-6 mb-2">
                    <h3 className="text-lg font-semibold">Command History</h3>
                    <button
                      onClick={() => handleClearHistory(system.id)}
                      className="px-3 py-1 text-sm text-red-600 hover:text-red-800 border border-red-300 hover:border-red-500 rounded"
                    >
                      Clear History
                    </button>
                  </div>
                  <CommandResults results={system.commandResults} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
};

export default Home;
