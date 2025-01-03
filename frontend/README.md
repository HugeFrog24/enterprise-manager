# Enterprise Manager Frontend

This is the Next.js frontend for the Enterprise Manager system. It provides a modern web interface to interact with the Enterprise Manager's control server.

## Features

- Real-time system status monitoring
- Task execution interface
- System management capabilities
- Modern, responsive UI with Tailwind CSS

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Routes

- `GET /api/systems` - Get all systems and their status
- `POST /api/systems/:id/tasks` - Send a task to a specific system

## Development

- Built with Next.js 14
- Uses TypeScript for type safety
- Styled with Tailwind CSS
- Follows modern React best practices with hooks and functional components
