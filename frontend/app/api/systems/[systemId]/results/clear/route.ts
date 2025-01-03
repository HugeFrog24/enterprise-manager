import { NextResponse } from 'next/server';
import { getTasks } from '@/lib/store/tasks';

export async function POST(
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

    // Clear tasks by overwriting with empty array
    const response = await fetch(`/api/tasks/clear?systemId=${systemId}`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Failed to clear tasks');
    }

    return NextResponse.json({ message: 'Command history cleared successfully' });
  } catch (error) {
    console.error('Error clearing command history:', error);
    return NextResponse.json(
      { error: 'Failed to clear command history' },
      { status: 500 }
    );
  }
} 