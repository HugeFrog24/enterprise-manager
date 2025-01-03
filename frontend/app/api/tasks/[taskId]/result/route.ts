import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { TaskResult } from '@/lib/types/api';

// Store tasks in the user's home directory or temp directory
const DATA_DIR = process.env.NODE_ENV === 'production' 
  ? path.join(os.homedir(), '.enterprise-manager')
  : path.join(os.tmpdir(), 'enterprise-manager');

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

interface FileSystemError extends Error {
  code?: string;
}

// Helper function to ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { taskId: string } }
): Promise<NextResponse> {
  try {
    const taskId = params.taskId;
    const requestBody = await req.json();

    // Extract systemId and taskResult from the request body
    const { systemId, ...taskResult } = requestBody;

    if (!systemId) {
      return NextResponse.json({ error: 'Missing systemId in request body' }, { status: 400 });
    }

    // Ensure data directory exists
    await ensureDataDir();

    // Read the existing tasks from the file (or create an empty file if it doesn't exist)
    let tasksData;
    try {
      const fileData = await fs.readFile(TASKS_FILE, 'utf8');
      tasksData = JSON.parse(fileData);
    } catch (error) {
      const fsError = error as FileSystemError;
      if (fsError.code === 'ENOENT') {
        tasksData = {}; // Initialize with an empty object
        await fs.writeFile(TASKS_FILE, JSON.stringify(tasksData, null, 2));
        console.log(`Created file: ${TASKS_FILE}`);
      } else {
        throw error; // Re-throw if it's not an ENOENT error
      }
    }

    // Initialize systemTasks with an empty array if it doesn't exist
    if (!tasksData[systemId]) {
      tasksData[systemId] = [];
    }

    // Find the system's tasks
    const systemTasks = tasksData[systemId];

    // Find the index of the task to be updated
    const taskIndex = systemTasks.findIndex((task: any) => task.id === taskId);

    if (taskIndex === -1) {
      return NextResponse.json({ error: `Task ${taskId} not found for system ${systemId}` }, { status: 404 });
    }

    // Update the task with the new result
    systemTasks[taskIndex] = {
      ...systemTasks[taskIndex],
      status: taskResult.status,
      output: taskResult.output,
      error: taskResult.error,
      exitCode: taskResult.exitCode,
      endTime: taskResult.endTime
    };

    // Write the updated tasks back to the file
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasksData, null, 2));

    return NextResponse.json({ message: 'Task result updated successfully' });
  } catch (error) {
    console.error('Error updating task result:', error);
    return NextResponse.json({ error: 'Failed to update task result' }, { status: 500 });
  }
} 