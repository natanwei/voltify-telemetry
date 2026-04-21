import './globals.css'

export const metadata = {
  title: 'Voltify Fleet',
  description: 'Telemetry pipeline prototype',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="brand">
            <span className="dot" /> Voltify
          </div>
          <nav>
            <a href="/">Fleet</a>
            <a href="/alerts">Alerts</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
