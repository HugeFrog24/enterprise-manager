import { NextResponse } from 'next/server';
import type { System } from '@/lib/types/api';
import fs from 'fs/promises';
import path from 'path';

// Get the lastResults from the tasks result route
import { getLastResults } from '../../tasks/result/route';

// File to persist systems
const SYSTEMS_FILE = path.join(process.cwd(), 'data', 'systems.json');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');

// Initialize data directory
const initializeDataDir = async () => {
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
};

// Initialize on module load
initializeDataDir().catch(console.error);

export async function POST(req: Request) {
  try {
    const system: Partial<System> = await req.json();
    
    // Load current systems
    let systems: System[] = [];
    try {
      const data = await fs.readFile(SYSTEMS_FILE, 'utf-8');
      systems = JSON.parse(data);
    } catch (error) {
      // If file doesn't exist or is empty, start with empty array
      systems = [];
    }
    
    // Update or add the system
    const index = systems.findIndex(s => s.id === system.id);
    if (index !== -1) {
      // Preserve existing system data and update with new data
      // Ensure health data is preserved if not provided in update
      const existingHealth = systems[index].health;
      systems[index] = {
        ...systems[index],
        ...system,
        health: system.health || existingHealth,
        lastHeartbeat: new Date().toISOString(),
      };
    } else {
      // Add new system with default status values
      systems.push({
        ...system,
        tier1Status: 'running',
        tier2Status: 'running',
        mainProcessStatus: 'running',
        lastHeartbeat: new Date().toISOString(),
      } as System);
    }

    // Write updated systems back to file
    await fs.writeFile(SYSTEMS_FILE, JSON.stringify(systems, null, 2));
    
    return NextResponse.json({ success: true });
  } catch (err) {
    // Log the error for debugging purposes
    console.error('Error registering system:', err);
    return NextResponse.json({ error: 'Failed to register system' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const data = await fs.readFile(SYSTEMS_FILE, 'utf-8');
    const systems: System[] = JSON.parse(data);
    const lastResults = getLastResults();
    const systemsWithResults = systems.map(system => ({
      ...system,
      lastCommandResult: lastResults[system.id] || null
    }));
    return NextResponse.json(systemsWithResults);
  } catch (error) {
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json([]);
    }
    console.error('Error loading systems:', error);
    return NextResponse.json(
      { error: 'Failed to load systems' },
      { status: 500 }
    );
  }
}
