import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { System } from '@/lib/types/api';

const SYSTEMS_FILE = path.join(process.cwd(), 'data', 'systems.json');

// GET /api/systems - Get all systems
export async function GET() {
  try {
    const fileContents = await fs.readFile(SYSTEMS_FILE, 'utf-8');
    const systems: System[] = JSON.parse(fileContents);
    return NextResponse.json(systems);
  } catch (error) {
    console.error('Error reading systems:', error);
    return NextResponse.json(
      { error: 'Failed to fetch systems' },
      { status: 500 }
    );
  }
}

// POST /api/systems/:id/tasks - Send task to a system
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const fileContents = await fs.readFile(SYSTEMS_FILE, 'utf-8');
    const systems: System[] = JSON.parse(fileContents);
    
    const system = systems.find(s => s.id === params.id);
    if (!system) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      );
    }
    
    const task = {
      id: crypto.randomUUID(),
      systemId: params.id,
      command: body.command,
      args: body.args || [],
      status: 'pending',
      output: '',
      error: null,
      exitCode: null,
      startTime: new Date().toISOString(),
      endTime: null
    };

    // In a real implementation, we would send the task to the actual system
    // For now, we'll just return the task
    return NextResponse.json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
