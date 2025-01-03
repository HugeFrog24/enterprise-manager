import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { System } from '@/lib/types/api';

const SYSTEMS_FILE = path.join(process.cwd(), 'data', 'systems.json');

export async function PATCH(
  request: NextRequest,
  { params }: { params: { systemId: string } }
) {
  try {
    const update = await request.json();
    const data = await fs.readFile(SYSTEMS_FILE, 'utf-8');
    const systems: System[] = JSON.parse(data);

    // Find system index
    const systemIndex = systems.findIndex(system => system.id === params.systemId);
    if (systemIndex === -1) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      );
    }

    // Update system with new data
    systems[systemIndex] = {
      ...systems[systemIndex],
      ...update
    };

    // Write updated systems back to file
    await fs.writeFile(SYSTEMS_FILE, JSON.stringify(systems, null, 2));

    return NextResponse.json(systems[systemIndex]);
  } catch (error) {
    console.error('Error updating system:', error);
    return NextResponse.json(
      { error: 'Failed to update system' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { systemId: string } }
) {
  try {
    // Read current systems
    const data = await fs.readFile(SYSTEMS_FILE, 'utf-8');
    const systems: System[] = JSON.parse(data);

    // Find system index
    const systemIndex = systems.findIndex(system => system.id === params.systemId);
    if (systemIndex === -1) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      );
    }

    // Remove system
    systems.splice(systemIndex, 1);

    // Write updated systems back to file
    await fs.writeFile(SYSTEMS_FILE, JSON.stringify(systems, null, 2));

    return NextResponse.json({ message: 'System unregistered successfully' });
  } catch (error) {
    console.error('Error unregistering system:', error);
    return NextResponse.json(
      { error: 'Failed to unregister system' },
      { status: 500 }
    );
  }
} 