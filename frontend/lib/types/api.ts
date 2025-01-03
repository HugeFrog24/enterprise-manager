export interface System {
  id: string;
  name: string;
  hostname: string;
  lastHeartbeat: string;
  tier1Status: 'running' | 'stopped' | 'error';
  tier2Status: 'running' | 'stopped' | 'error';
  mainProcessStatus: 'running' | 'stopped' | 'error';
  hostInfo: string;
  health?: SystemHealth;
  commandResults?: CommandResult[];
}

export interface Task {
  id: string;
  systemId: string;
  command: string;
  args: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string;
  error: string | null;
  exitCode: number | null;
  startTime: string;
  endTime: string | null;
}

export interface SystemHealth {
  tier1Uptime: number;
  tier2Uptime: number;
  mainProcessUptime: number;
  lastHeartbeat: string;
  memoryUsage: number;
  cpuUsage: number;
}

export interface CommandResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string;
  error: string | null;
  exitCode: number | null;
  startTime: string;
  endTime: string | null;
}

export type TaskResult = {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string;
  error: string | null;
  exitCode: number | null;
  startTime: string;
  endTime: string | null;
};

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export type WSMessageType = 'health' | 'command_output' | 'command_status' | 'execute_command' | 'task_result';

export interface WSMessage<T = any> {
  type: WSMessageType;
  data: T;
}

export interface WSCommandOutput {
  commandId: string;
  output: string;
  status?: string;
  exitCode?: number;
}

export interface WSTaskResult extends TaskResult {
  systemId?: string;
}

export interface WSExecuteCommand {
  systemId: string;
  command: string;
  args: string[];
}

export type WebSocketMessage = {
  type: string;
  data: unknown;
};
