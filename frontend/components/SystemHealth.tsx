'use client';

import React, { useState, useEffect } from 'react';
import type { System, SystemHealth } from '../lib/types/api';
import { useWebSocket } from '../lib/websocket';

type SystemHealthProps = {
  health: SystemHealth;
  system: System;
  lastHeartbeat: string;
};

export const SystemHealth: React.FC<SystemHealthProps> = ({ health, system, lastHeartbeat }) => {
  const [isConnected, setIsConnected] = useState(false);
  const { isHealthSocketOpen, isTaskSocketOpen } = useWebSocket();

  useEffect(() => {
    setIsConnected(isHealthSocketOpen && isTaskSocketOpen);
  }, [isHealthSocketOpen, isTaskSocketOpen]);

  const lastHeartbeatDate = new Date(lastHeartbeat);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - lastHeartbeatDate.getTime()) / 1000);

  return (
    <div className="mt-4">
      <h3 className="font-bold">System Health:</h3>
      <div className="flex items-center mt-2">
        <div
          className={`w-3 h-3 rounded-full mr-2 ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span>{isConnected ? 'Connected' : 'Connecting...'}</span>
      </div>
      {isConnected && (
        <>
          <p>CPU Usage: {health.cpuUsage.toFixed(2)}%</p>
          <p>Memory Usage: {health.memoryUsage.toFixed(2)}%</p>
          <p>Tier 1 Uptime: {health.tier1Uptime.toFixed(2)} hours</p>
          <p>Tier 2 Uptime: {health.tier2Uptime.toFixed(2)} hours</p>
          <p>Main Process Uptime: {health.mainProcessUptime.toFixed(2)} hours</p>
          <p>
            Last Heartbeat: {diffInSeconds} seconds ago (
            {lastHeartbeatDate.toLocaleString()})
          </p>
        </>
      )}
    </div>
  );
};
