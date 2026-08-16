# Contributing to RepoButler

We welcome contributions to RepoButler! To maintain code health, simplicity, and security, please follow these guidelines.

## Code Style & Principles

We adhere strictly to the **Ponytail (Minimalist) Philosophy**:
- **YAGNI**: Question if a feature needs to exist at all before writing it.
- **Native Over Custom**: Use standard library features, native HTML tags, and Tailwind CSS primitives before pulling in heavy NPM modules.
- **Fewest Files Possible**: Keep diff sizes minimal and maintain clean architectural bounds.
- **Explainability**: Every calculation and user-facing metric must be grounded in actual repository data and deterministic.

## Development Workflow

1. Fork the repository and create your feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. Write unit tests for any new rules or calculations in `tests/`.
3. Verify that the project compiles and all tests pass:
   ```bash
   npx tsc --noEmit
   npm run test
   ```
4. Submit a Pull Request. Ensure that you ground your work in the PR template.
