// import type { I18n } from '@lingui/core';
// import { msg } from '@lingui/core/macro';
// import type { DocumentMeta, Envelope, RecipientRole } from '@prisma/client';
// import Konva from 'konva';
// import 'konva/skia-backend';
// import fs from 'node:fs';
// import path from 'node:path';
// import type { DateTimeFormatOptions } from 'luxon';
// import { DateTime } from 'luxon';
// import type { Canvas } from 'skia-canvas';
// import { Image as SkiaImage } from 'skia-canvas';
// import { match, P } from 'ts-pattern';
// import { UAParser } from 'ua-parser-js';
// import { DOCUMENT_STATUS } from '../../constants/document';
// import { APP_I18N_OPTIONS } from '../../constants/i18n';
// import { RECIPIENT_ROLES_DESCRIPTION } from '../../constants/recipient-roles';
// import type { TDocumentAuditLog } from '../../types/document-audit-logs';
// import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
// import { formatDocumentAuditLogAction } from '../../utils/document-audit-logs';
// import { ensureFontLibrary } from './helpers';

// ── snippet ──

  // Row 1 Column 2
  const ipAddressLabel = renderVerticalLabelAndText({
    label: i18n._(msg`IP Address`).toUpperCase(),
    text: auditLog.ipAddress || 'N/A',
    align: 'right',
    x: columnWidth + columnSpacing,
    width: columnWidth,
    textFontFamily: 'ui-monospace',
  });

  bottomSection.add(userLabel);
  bottomSection.add(ipAddressLabel);

  parser.setUA(auditLog.userAgent || '');
  const userAgentInfo = parser.getResult();

  // Row 2 Column 1
  const userAgentLabel = renderVerticalLabelAndText({
    label: i18n._(msg`User Agent`).toUpperCase(),
    text: i18n._(formatUserAgent(auditLog.userAgent, userAgentInfo)),
    align: 'left',
    width,
    y: bottomSection.getClientRect().height + 16,
  });

  bottomSection.add(userAgentLabel);
  rowGroup.add(bottomSection);

  const cardRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: rowGroup.getClientRect().width,
    height: rowGroup.getClientRect().height + paddingWithinCard * 2,
    stroke: '#e5e7eb',
    strokeWidth: 1,
    cornerRadius: 8,
  });

  rowGroup.add(cardRect);

  return rowGroup;
};

const renderBranding = () => {
  const branding = new Konva.Group();

  const brandingHeight = 16;

  const logoPath = path.join(process.cwd(), 'public/static/logo.png');
  const logo = fs.readFileSync(logoPath);

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(logo) as unknown as HTMLImageElement;

  const brandingImage = new Konva.Image({
    image: img,
    height: brandingHeight,
    width: brandingHeight * (img.width / img.height),
  });

  branding.add(brandingImage);
  return branding;
};

type GroupRowsIntoPagesOptions = {
  auditLogs: TDocumentAuditLog[];
  maxHeight: number;
  contentWidth: number;
  i18n: I18n;
  overviewCard: Konva.Group;
};

const groupRowsIntoPages = (options: GroupRowsIntoPagesOptions) => {
  const { auditLogs, maxHeight, contentWidth, i18n, overviewCard } = options;

  const groupedRows: Konva.Group[][] = [[]];

  const overviewCardHeight = overviewCard.getClientRect().height;

  // First page has title + overview card
  let availableHeight = maxHeight - pageTopMargin - overviewCardHeight;
  let currentGroupedRowIndex = 0;

  // Group rows into pages.
  for (const auditLog of auditLogs) {
    const row = renderRow({ auditLog, width: contentWidth, i18n });

    const rowHeight = row.getClientRect().height;
    const requiredHeight = rowHeight + rowPadding;

    if (requiredHeight > availableHeight) {
      currentGroupedRowIndex++;
      groupedRows[currentGroupedRowIndex] = [row];

      // Subsequent pages only have title (no overview card)
      availableHeight = maxHeight - pageTopMargin;
    } else {
      groupedRows[currentGroupedRowIndex].push(row);
    }