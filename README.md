# Bitbucket Server MCP

MCP (Model Context Protocol) server for Bitbucket Server Pull Request management. This server provides tools and resources to interact with the Bitbucket Server API through the MCP protocol.

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Features

The server provides the following tools for Bitbucket Server integration:

### `create_pull_request`
Creates a new pull request with specified title, description, source branch, target branch, and optional reviewers.

### `get_pull_request`
Retrieves detailed information about a specific pull request by its ID.

### `merge_pull_request`
Merges a pull request using one of three strategies:
- merge-commit (default)
- squash
- fast-forward

### `decline_pull_request`
Declines a pull request with an optional message explaining the reason.

### `add_comment`
Adds a comment to a pull request. Supports both top-level comments and replies to existing comments.

### `get_diff`
Retrieves the diff for a pull request with configurable context lines.

### `get_reviews`
Fetches the review history of a pull request, including approvals and reviews.

## Core Dependencies

- `@modelcontextprotocol/sdk` - SDK for MCP protocol implementation
- `axios` - HTTP client for API requests
- `winston` - Logging

## Configuration

The server requires configuration in the VSCode MCP settings file. Here's a sample configuration:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/path/to/bitbucket-server/build/index.js"],
      "env": {
        "BITBUCKET_URL": "https://your-bitbucket-server.com",
        "BITBUCKET_PROJECT": "PROJECT",
        "BITBUCKET_REPOSITORY": "repository-name",
        // Authentication (choose one):
        // Option 1: Personal Access Token
        "BITBUCKET_TOKEN": "your-access-token",
        // Option 2: Username/Password
        "BITBUCKET_USERNAME": "your-username",
        "BITBUCKET_PASSWORD": "your-password"
      }
    }
  }
}
```

### Environment Variables

- `BITBUCKET_URL` (required): Base URL of your Bitbucket Server instance
- `BITBUCKET_PROJECT` (required): Bitbucket project key
- `BITBUCKET_REPOSITORY` (required): Repository slug/name
- Authentication (one of the following is required):
  - `BITBUCKET_TOKEN`: Personal access token
  - `BITBUCKET_USERNAME` and `BITBUCKET_PASSWORD`: Basic authentication credentials

## Logging

The server logs all operations to `bitbucket.log` for debugging and monitoring purposes.
