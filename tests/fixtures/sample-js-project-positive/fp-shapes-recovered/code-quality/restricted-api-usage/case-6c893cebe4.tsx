// import { useCallback, useEffect, useRef, useState } from 'react';
// import { useNavigate, useSearchParams } from 'react-router';

// ── snippet ──
    destructive: '',
    destructiveForeground: '',
    ring: '',
    radius: '',
    warning: '',
  });

  const [isResolvingToken, setIsResolvingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasAutoLaunched = useRef(false);

  /**
   * If the token starts with "api_", exchange it for a presign token
   * via the embedding presign endpoint. Otherwise return as-is.
   */
  const resolveToken = async (inputToken: string): Promise<string> => {
    if (!inputToken.startsWith('api_')) {
      return inputToken;
    }

    const response = await fetch('/api/v2/embedding/create-presign-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${inputToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to exchange API token (${response.status}): ${text}`);
    }

    const data = await response.json();
    const presignToken = data?.token;

    if (!presignToken || typeof presignToken !== 'string') {
      throw new Error(`Unexpected response shape: ${JSON.stringify(data)}`);
    }

    return presignToken;
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const timestamp = new Date().toISOString().slice(11, 19);
      setMessages((prev) => [...prev, `[${timestamp}] ${JSON.stringify(event.data, null, 2)}`]);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-launch on mount if token is present in query params
  useEffect(() => {
    if (hasAutoLaunched.current) {
      return;
    }

    const initialToken = searchParams.get('token');

    if (initialToken) {
      hasAutoLaunched.current = true;
      void launchEmbed(initialToken);
    }
  }, []);

  const updateQueryParams = (params: {
    token: string;
    externalId: string;
    mode: string;
    envelopeId: string;
    envelopeType: string;
    folderId: string;
    language: string;
  }) => {
    const newParams = new URLSearchParams();

    if (params.token) {
      newParams.set('token', params.token);
    }

    if (params.externalId) {
      newParams.set('externalId', params.externalId);
    }

    if (params.mode && params.mode !== 'create') {
      newParams.set('mode', params.mode);
    }

    if (params.envelopeId) {
      newParams.set('envelopeId', params.envelopeId);
    }