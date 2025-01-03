import type { Task, TaskResult } from '../types/api';

// In-memory cache for tasks
const tasksCache: Record<string, Task[]> = {};

// Get tasks for a specific system
export async function getTasks(systemId: string): Promise<Task[]> {
  try {
    const response = await fetch(`/api/tasks?systemId=${systemId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch tasks');
    }
    const { data } = await response.json();
    tasksCache[systemId] = data;
    return data;
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return tasksCache[systemId] || [];
  }
}

// Save a task to the cache and server
export async function saveTask(task: Task): Promise<Task | null> {
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });
    
    if (!response.ok) {
      throw new Error('Failed to save task');
    }
    
    const { data } = await response.json();
    
    // Update cache
    const systemTasks = tasksCache[task.systemId] || [];
    const taskIndex = systemTasks.findIndex(t => t.id === task.id);

    if (taskIndex !== -1) {
      // Update existing task
      systemTasks[taskIndex] = data;
    } else {
      // Add new task
      systemTasks.unshift(data);
    }

    tasksCache[task.systemId] = systemTasks;
    return data;
  } catch (error) {
    console.error('Error saving task:', error);
    return null;
  }
}

// Get tasks for a specific system from cache
export function getSystemTasks(systemId: string): Task[] {
  return tasksCache[systemId] || [];
}

// Add a new task to the cache and server
export async function addTask(task: Task): Promise<Task | null> {
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });
    
    if (!response.ok) {
      throw new Error('Failed to add task');
    }
    
    const { data } = await response.json();
    
    // Update cache
    const systemTasks = tasksCache[task.systemId] || [];
    systemTasks.unshift(data);
    tasksCache[task.systemId] = systemTasks;
    
    return data;
  } catch (error) {
    console.error('Error adding task:', error);
    return null;
  }
}

// Update an existing task in the cache and server
export async function updateTask(task: Task): Promise<Task | null> {
  try {
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update task');
    }
    
    const { data } = await response.json();
    
    // Update cache
    const systemTasks = tasksCache[task.systemId] || [];
    const taskIndex = systemTasks.findIndex(t => t.id === task.id);

    if (taskIndex !== -1) {
      // Update existing task
      systemTasks[taskIndex] = data;
    } else {
      // Add new task if it doesn't exist
      systemTasks.unshift(data);
    }

    tasksCache[task.systemId] = systemTasks;
    return data;
  } catch (error) {
    console.error('Error updating task:', error);
    return null;
  }
}

// Update task result in the cache and server
export async function updateTaskResult(systemId: string, taskId: string, taskResult: TaskResult): Promise<boolean> {
  try {
    const response = await fetch(`/api/tasks/${taskId}/result`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ systemId, ...taskResult }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error || 'Failed to update task result';
      console.error('Error updating task result:', errorMessage);
      throw new Error(errorMessage);
    }

    // Update cache
    const systemTasks = tasksCache[systemId] || [];
    const taskIndex = systemTasks.findIndex(t => t.id === taskId);

    if (taskIndex !== -1) {
      // Update existing task with result data
      systemTasks[taskIndex] = {
        ...systemTasks[taskIndex],
        status: taskResult.status,
        output: taskResult.output,
        error: taskResult.error,
        exitCode: taskResult.exitCode,
        endTime: taskResult.endTime
      };
      tasksCache[systemId] = systemTasks;
    }

    return true;
  } catch (error) {
    console.error('Error updating task result:', error);
    return false;
  }
}

// Clear tasks for a specific system from cache and server
export async function clearSystemTasks(systemId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/tasks?systemId=${systemId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error('Failed to clear tasks');
    }
    
    // Clear cache
    delete tasksCache[systemId];
    return true;
  } catch (error) {
    console.error('Error clearing tasks:', error);
    return false;
  }
}
