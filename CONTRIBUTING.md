# Contributing to @mvp-kit/vite-sitemap-plugin

Thank you for your interest in contributing! We welcome all types of contributions.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mvp-kit/vite-sitemap-plugin.git
   cd vite-sitemap-plugin
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the plugin**
   ```bash
   npm run build
   ```

4. **Run in development mode**
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
  index.ts          # Main plugin code
dist/               # Built output
README.md           # Documentation
LICENSE             # MIT License
```

## Development Workflow

1. **Make your changes** in `src/index.ts`
2. **Build** with `npm run build`
3. **Test** your changes in a sample project
4. **Submit a pull request**

## Code Style

- Use TypeScript
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Ensure type safety

## Testing

Currently manual testing is required:

1. Build the plugin
2. Use it in a Vite project with TanStack Router
3. Verify sitemap generation works correctly

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Issues

- Use GitHub Issues for bug reports and feature requests
- Provide reproduction steps for bugs
- Include environment details (Node.js version, Vite version, etc.)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.