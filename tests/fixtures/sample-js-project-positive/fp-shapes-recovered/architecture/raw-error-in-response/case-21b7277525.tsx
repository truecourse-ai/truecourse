// import { useCallback, useEffect, useRef, useState } from 'react';
// import { useNavigate, useSearchParams } from 'react-router';

// ── snippet ──
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

    if (params.envelopeType && params.envelopeType !== 'DOCUMENT') {
      newParams.set('envelopeType', params.envelopeType);
    }

    if (params.folderId) {
      newParams.set('folderId', params.folderId);
    }

    if (params.language) {
      newParams.set('language', params.language);
    }

    const qs = newParams.toString();

    void navigate(qs ? `?${qs}` : '.', { replace: true });
  };

  const launchEmbed = async (overrideToken?: string) => {
    const inputToken = overrideToken ?? token;

    if (!inputToken) {
      return;
    }

    setTokenError(null);
    setIsResolvingToken(true);

    let presignToken: string;

    try {
      presignToken = await resolveToken(inputToken);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
      setIsResolvingToken(false);
      return;
    }

    setIsResolvingToken(false);

    // Filter out empty cssVars entries
    const filteredCssVars: Record<string, string> = {};

    for (const [key, value] of Object.entries(cssVars)) {
      if (value) {
        filteredCssVars[key] = value;
      }
    }

    const hashData = {
      externalId: externalId || undefined,
      type: mode === 'create' ? envelopeType : undefined,
      folderId: mode === 'create' && folderId ? folderId : undefined,
      language: language || undefined,
      darkModeDisabled: darkModeDisabled || undefined,
      css: rawCss || undefined,
      cssVars: Object.keys(filteredCssVars).length > 0 ? filteredCssVars : undefined,
      features: {
        general: generalFeatures,
        settings: settingsFeatures,
        actions: actionsFeatures,
        envelopeItems: envelopeItemsFeatures,
        recipients: recipientsFeatures,
        fields: fieldsFeatures,
      },
    };

    const hash = btoa(encodeURIComponent(JSON.stringify(hashData)));

    const basePath =
      mode === 'create' ? '/embed/v2/authoring/envelope/create' : `/embed/v2/authoring/envelope/edit/${envelopeId}`;

    const buildIframeSrc = (path: string, tokenValue: string, hashValue: string): string => {
      // Ensure the token is treated strictly as a query parameter value.
      const encodedToken = encodeURIComponent(tokenValue);
      return `${path}?token=${encodedToken}#${hashValue}`;
    };

    setIframeSrc(buildIframeSrc(basePath, presignToken, hash));
    setIframeKey((prev) => prev + 1);

    updateQueryParams({
      token: inputToken,