import { NextResponse } from 'next/server';
import type { Task } from '@/lib/types/api';
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const systemId = searchParams.get('systemId');

  if (!systemId) {
    return NextResponse.json({ error: 'System ID is required' }, { status: 400 });
  }

  try {
    const tasks = await readTasksFromFile();
    return NextResponse.json({ data: tasks[systemId] || [] });
  } catch (error) {
    console.error('Error reading tasks:', error);
    return NextResponse.json({ error: 'Failed to read tasks', data: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const task = await req.json();
  
  if (!task.id || !task.command || !task.systemId) {
    return NextResponse.json({ error: 'Task ID, Command, and System ID are required' }, { status: 400 });
  }

  try {
    // Add task to storage with initial status
    const newTask: Task = {
      id: task.id,
      systemId: task.systemId,
      command: task.command,
      args: task.args || [],
      status: 'pending',
      output: '',
      error: null,
      exitCode: null,
      startTime: new Date().toISOString(),
      endTime: null
    };

    const tasks = await readTasksFromFile();
    const systemTasks = tasks[task.systemId] || [];
    tasks[task.systemId] = [...systemTasks, newTask];
    await writeTasksToFile(tasks);

    return NextResponse.json({ data: newTask });
  } catch (error) {
    console.error('Error saving task:', error);
    return NextResponse.json({ error: 'Failed to save task' }, { status: 500 });
  }
}
