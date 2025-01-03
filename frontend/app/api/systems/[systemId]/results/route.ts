import { NextResponse } from 'next/server';
import type { CommandResult } from '@/lib/types/api';
import { getSystemTasks } from '@/lib/store/tasks';

export async function GET(
  request: Request,
  { params }: { params: { systemId: string } }
) {
  try {
    const systemId = params.systemId;
    if (!systemId) {
      return NextResponse.json(
        { error: 'System ID is required' },
        { status: 400 }
      );
    }

    const tasks = getSystemTasks(systemId);
    
    // Convert tasks to command results format
    const results: CommandResult[] = tasks.map(task => ({
      taskId: task.id,
      status: task.status,
      output: task.output,
      error: task.error,
      exitCode: task.exitCode || 0,
      startTime: task.startTime,
      endTime: task.endTime || task.startTime
    }));

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('Error fetching system results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system results', data: [] },
      { status: 500 }
    );
  }
}
