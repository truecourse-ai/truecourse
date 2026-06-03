/**
 * React Email template — components from `@react-email/components` are
 * rendered to HTML server-side before sending, so inline object/array
 * literals in JSX props have no re-render cost. The template is invoked
 * once per email.
 */

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

const page = { backgroundColor: '#f7f7f7', fontFamily: 'sans-serif' };
const card = { padding: '24px', borderRadius: 8 };
const heading = { fontSize: 20, color: '#111' };
const paragraph = { color: '#333', lineHeight: 1.5 };
const linkBase = { color: '#1d4ed8', textDecoration: 'underline' };

interface NotificationEmailProps {
  readonly recipientName: string;
  readonly itemLabel: string;
  readonly summary: string;
  readonly itemHref: string;
}

export function NotificationEmail(props: NotificationEmailProps): JSX.Element {
  const { recipientName, itemLabel, summary, itemHref } = props;
  return (
    <Html>
      <Head />
      <Preview>{`Update on ${itemLabel}`}</Preview>
      <Body style={page}>
        <Container style={card}>
          <Heading style={heading}>Hello {recipientName}</Heading>
          <Section style={{ marginBottom: 16 }}>
            <Text style={paragraph}>{summary}</Text>
          </Section>
          <Link
            href={itemHref}
            target="_blank"
            style={{ ...linkBase, display: 'block', marginTop: '24px' }}
          >
            View details
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
