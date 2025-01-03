import { NextResponse } from 'next/server';
import type { TaskResult, Task } from '@/lib/types/api';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Store tasks in the user's home directory or temp directory
const DATA_DIR = process.env.NODE_ENV === 'production' 
  ? path.join(os.homedir(), '.enterprise-manager')
  : path.join(os.tmpdir(), 'enterprise-manager');

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

// Helper function to ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Helper function to read tasks from file
async function readTasksFromFile(): Promise<Record<string, Task[]>> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // If file doesn't exist, create it with empty data
      const emptyData = {};
      await fs.writeFile(TASKS_FILE, JSON.stringify(emptyData, null, 2));
      return emptyData;
    }
    console.error('Error reading tasks file:', error);
    return {};
  }
}

// Helper function to write tasks to file
async function writeTasksToFile(tasks: Record<string, Task[]>): Promise<void> {
  await ensureDataDir();
  try {
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), { encoding: 'utf-8', flag: 'w' });
  } catch (error) {
    console.error('Error writing tasks file:', error);
    throw error; // Propagate error to handle it in the route handlers
  }
}

export async function POST(req: Request) {
  const result = await req.json() as TaskResult;
  
  if (!result.taskId) {
    return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
  }

  try {
    const tasks = await readTasksFromFile();
    const systemId = result.taskId.split('-')[0]; // Assuming taskId format includes systemId
    const systemTasks = tasks[systemId] || [];
    const taskIndex = systemTasks.findIndex(t => t.id === result.taskId);

    if (taskIndex === -1) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Update the task with new result data
    systemTasks[taskIndex] = {
      ...systemTasks[taskIndex],
      status: result.status,
      output: result.output || systemTasks[taskIndex].output,
      error: result.error,
      exitCode: result.exitCode,
      endTime: result.endTime
    };

    // Save updated tasks
    tasks[systemId] = systemTasks;
    await writeTasksToFile(tasks);

    return NextResponse.json({ data: systemTasks[taskIndex] });
  } catch (error) {
    console.error('Error updating task result:', error);
    return NextResponse.json({ error: 'Failed to update task result' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
  }

  try {
    const tasks = await readTasksFromFile();
    const systemId = taskId.split('-')[0]; // Assuming taskId format includes systemId
    const systemTasks = tasks[systemId] || [];
    const task = systemTasks.find(t => t.id === taskId);
    
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    return NextResponse.json({ data: task });
  } catch (error) {
    console.error('Error fetching task:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}
