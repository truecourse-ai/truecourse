// Next.js metadata: metadataBase requires an absolute URL for the canonical docs site origin.
export const metadata = {
  metadataBase: new URL('https://docs.myapp.io'),
  title: 'MyApp Documentation',
  description: 'Official documentation for MyApp.',
};



declare const Inter: { variable: string; className: string };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={Inter.variable}>
      <body className={`${Inter.className} antialiased`}>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
