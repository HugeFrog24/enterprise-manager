import { System, Task, CommandResult } from '../types/api';

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private static instance: ApiClient;
  private baseUrl: string;

  private constructor() {
    this.baseUrl = '/api';
  }

  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new ApiError(
        responseData.error || 'An unknown error occurred',
        response.status
      );
    }

    // If response is already wrapped in ApiResponse format, return it
    if (responseData.hasOwnProperty('data') || responseData.hasOwnProperty('error')) {
      return responseData;
    }

    // Otherwise wrap the response data
    return { data: responseData };
  }

  // System Management
  async getSystems(): Promise<System[]> {
    try {
      const response = await this.fetch<System[]>('/systems');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching systems:', error);
      throw error;
    }
  }

  async getSystem(id: string): Promise<System> {
    const response = await this.fetch<System>(`/systems/${id}`);
    if (!response.data) {
      throw new ApiError('System not found');
    }
    return response.data;
  }

  async getSystemHealth(id: string): Promise<SystemHealth> {
    const response = await this.fetch<SystemHealth>(`/systems/${id}/health`);
    if (!response.data) {
      throw new ApiError('System health not found');
    }
    return response.data;
  }

  async getSystemCommandResults(systemId: string): Promise<CommandResult[]> {
    const response = await this.fetch<CommandResult[]>(`/systems/${systemId}/results`);
    if (!response.data) {
      return [];
    }
    return response.data;
  }

  async clearSystemCommandResults(systemId: string): Promise<void> {
    await this.fetch<void>(`/systems/${systemId}/results/clear`, {
      method: 'POST'
    });
  }

  // Task Management
  async createTask(systemId: string, command: string, args: string[] = []): Promise<Task> {
    const taskId = crypto.randomUUID();
    const response = await this.fetch<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        id: taskId,
        systemId,
        command,
        args,
      }),
    });
    
    if (!response.data) {
      throw new ApiError('Failed to create task');
    }
    return response.data;
  }

  async getTask(taskId: string): Promise<Task> {
    const response = await this.fetch<Task>(`/tasks/${taskId}`);
    if (!response.data) {
      throw new ApiError('Task not found');
    }
    return response.data;
  }

  async getTaskResult(taskId: string): Promise<TaskResult> {
    const response = await this.fetch<{ data: TaskResult }>(`/tasks/${taskId}/result`);
    if (!response.data) {
      throw new ApiError('Task result not found');
    }
    return response.data;
  }

  // Process Management
  async restartTier1(systemId: string): Promise<void> {
    await this.fetch<void>(`/systems/${systemId}/tier1/restart`, {
      method: 'POST',
    });
  }

  async restartTier2(systemId: string): Promise<void> {
    await this.fetch<void>(`/systems/${systemId}/tier2/restart`, {
      method: 'POST',
    });
  }

  async restartMainProcess(systemId: string): Promise<void> {
    await this.fetch<void>(`/systems/${systemId}/main/restart`, {
      method: 'POST',
    });
  }

  // System deletion
  async deleteSystem(systemId: string): Promise<void> {
    try {
      await this.fetch<void>(`/systems/${systemId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError('System not found', 404);
      }
      throw error;
    }
  }
}
