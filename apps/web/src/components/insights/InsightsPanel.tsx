'use client';

import { Lightbulb, MessageCircle, Shield, Loader2 } from 'lucide-react';
import { InsightCard } from '@/components/insights/InsightCard';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { SchemaPanel } from '@/components/schema/SchemaPanel';
import { RulesPanel } from '@/components/rules/RulesPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { InsightResponse } from '@/lib/api';

type InsightsPanelProps = {
  insights: InsightResponse[];
  isLoading: boolean;
  repoId: string;
  selectedService?: string | null;
  selectedServiceName?: string | null;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  explainRequest?: { nodeId: string; nodeName: string } | null;
  onExplainHandled?: () => void;
  selectedDatabaseId?: string | null;
};

export function InsightsPanel({
  insights,
  isLoading,
  repoId,
  selectedService,
  selectedServiceName,
  activeTab = 'insights',
  onTabChange,
  explainRequest,
  onExplainHandled,
  selectedDatabaseId,
}: InsightsPanelProps) {
  const isChat = activeTab === 'chat';
  const isRules = activeTab === 'rules';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => onTabChange?.(String(v))} className="flex flex-shrink-0 flex-col">
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="insights">
            <Lightbulb className="h-4 w-4" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageCircle className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Shield className="h-4 w-4" />
            Rules
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Insights content */}
      <div className={`min-h-0 flex-1 flex flex-col overflow-hidden ${isChat || isRules ? 'hidden' : ''}`}>
        <div className={`overflow-y-auto p-3 ${selectedDatabaseId ? 'flex-1' : 'flex-1'}`}>
          {selectedService && (
            <div className="mb-3 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              Filtered by:{' '}
              <span className="font-medium text-foreground">
                {selectedServiceName || selectedService}
              </span>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : insights.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Lightbulb className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {selectedService
                  ? 'No insights for this service'
                  : 'No insights yet. Run an analysis to get insights.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </div>

        {/* ER diagram fills remaining space at the bottom */}
        {selectedDatabaseId && (
          <div className="flex-shrink-0 border-t border-border h-[264px]">
            <SchemaPanel repoId={repoId} databaseId={selectedDatabaseId} insights={insights} />
          </div>
        )}
      </div>

      {/* Chat content — always mounted, hidden when not active */}
      <div className={`min-h-0 flex-1 overflow-hidden ${isChat ? '' : 'hidden'}`}>
        <ChatPanel
          repoId={repoId}
          selectedService={selectedService}
          explainRequest={explainRequest}
          onExplainHandled={onExplainHandled}
        />
      </div>

      {/* Rules content */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${isRules ? '' : 'hidden'}`}>
        <RulesPanel />
      </div>
    </div>
  );
}
