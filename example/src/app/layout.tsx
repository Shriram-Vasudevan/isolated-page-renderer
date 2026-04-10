export const metadata = {
  title: 'Example App',
  description: 'Example Next.js app for state-render demo',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
