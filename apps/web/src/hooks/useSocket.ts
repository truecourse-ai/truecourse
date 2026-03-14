'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { connectSocket, disconnectSocket, joinRepoRoom, leaveRepoRoom, getSocket } from '@/lib/socket';

export type AnalysisProgress = {
  step: string;
  percent: number;
  detail?: string;
};

type EventHandler = (data: unknown) => void;

export function useSocket(repoId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const handlersRef = useRef<Map<string, EventHandler[]>>(new Map());

  useEffect(() => {
    const socket = connectSocket();

    function onConnect() {
      setIsConnected(true);
      if (repoId) {
        joinRepoRoom(repoId);
      }
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onAnalysisProgress(data: AnalysisProgress) {
      setAnalysisProgress(data);
    }

    function onAnalysisComplete(data: unknown) {
      setAnalysisProgress(null);
      handlersRef.current.get('analysis:complete')?.forEach((h) => h(data));
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('analysis:progress', onAnalysisProgress);
    socket.on('analysis:complete', onAnalysisComplete);
    socket.on('files:changed', (data: unknown) => {
      handlersRef.current.get('files:changed')?.forEach((h) => h(data));
    });
    socket.on('insights:ready', (data: unknown) => {
      setAnalysisProgress(null);
      handlersRef.current.get('insights:ready')?.forEach((h) => h(data));
    });

    if (socket.connected && repoId) {
      joinRepoRoom(repoId);
    }

    return () => {
      if (repoId) {
        leaveRepoRoom(repoId);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('analysis:progress', onAnalysisProgress);
      socket.off('analysis:complete', onAnalysisComplete);
      disconnectSocket();
    };
  }, [repoId]);

  const onEvent = useCallback((event: string, handler: EventHandler) => {
    const handlers = handlersRef.current.get(event) || [];
    handlers.push(handler);
    handlersRef.current.set(event, handlers);

    return () => {
      const current = handlersRef.current.get(event) || [];
      handlersRef.current.set(
        event,
        current.filter((h) => h !== handler),
      );
    };
  }, []);

  return { isConnected, analysisProgress, onEvent };
}
