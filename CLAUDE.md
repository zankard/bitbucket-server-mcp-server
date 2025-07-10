# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Bitbucket Server MCP (Model Context Protocol) server** that provides tools to interact with Bitbucket Server's API through the MCP protocol. It enables pull request management, project/repository discovery, and code review operations.

## Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript (outputs to `build/`)
- `npm run dev` - Watch mode compilation with TypeScript
- `npm run dev:server` - Build and run with MCP inspector in debug mode
- `npm start` - Run the compiled server from `build/index.js`

### Testing and Quality
- `npm test` - Run Jest tests (located in `src/__tests__/`)
- `npm run lint` - Run ESLint on TypeScript files
- `npm run format` - Format code with Prettier

### Utilities
- `npm run inspector` - Run MCP inspector on the built server
- `npm run update:check` - Check for outdated dependencies
- `npm run update:deps` - Update dependencies to latest versions

## Architecture

### Core Structure
- **Single file architecture**: All server logic is in `src/index.ts` (~650 lines)
- **BitbucketServer class**: Main server implementation with MCP SDK integration
- **Tool-based API**: Each Bitbucket operation is exposed as an MCP tool

### Key Components

#### Authentication & Configuration
- Supports both Personal Access Token and username/password authentication
- Environment variables: `BITBUCKET_URL`, `BITBUCKET_TOKEN`, `BITBUCKET_USERNAME/PASSWORD`
- Optional default project: `BITBUCKET_DEFAULT_PROJECT`

#### MCP Tools Implementation
The server exposes 8 main tools:
1. `list_projects` - Project discovery
2. `list_repositories` - Repository browsing
3. `create_pull_request` - PR creation
4. `get_pull_request` - PR details retrieval
5. `merge_pull_request` - PR merging with strategy selection
6. `decline_pull_request` - PR rejection
7. `add_comment` - PR commenting (supports both general and file line comments)
8. `get_diff` - Code difference retrieval
9. `get_reviews` - Review status checking

#### Project Parameter Handling
- All tools support optional `project` parameter
- Falls back to `BITBUCKET_DEFAULT_PROJECT` environment variable
- `getProject()` helper function ensures project is available for operations

### API Integration
- Uses Axios for HTTP requests to Bitbucket Server REST API v1.0
- Base URL: `${BITBUCKET_URL}/rest/api/1.0`
- Error handling with MCP-specific error codes
- Winston logging to track operations

### TypeScript Configuration
- ES2020 target with ES modules
- Strict type checking enabled
- Outputs to `build/` directory with declaration files
- Jest configured for ESM with ts-jest

## Development Notes

### File Structure
- `src/index.ts` - Main server implementation
- `src/__tests__/index.test.ts` - Test suite
- `build/` - Compiled JavaScript output
- `package.json` - Defines the executable as `bitbucket-server-mcp`

### Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `axios` - HTTP client for Bitbucket API
- `winston` - Logging framework

### Key Patterns
- Tool request handlers use switch statements for routing
- Input validation with TypeScript type guards
- Consistent error handling with MCP error codes
- All API responses returned as JSON text content
- File line comments use anchor objects with diffType, line, lineType, fileType, and path
- Optional parameters handled with proper fallbacks and validation