#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import winston from 'winston';

// Configuration du logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'bitbucket.log' })
  ]
});

interface BitbucketConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  project: string;
  repository: string;
}

interface PullRequestInput {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
}

class BitbucketServer {
  private server: Server;
  private api: AxiosInstance;
  private config: BitbucketConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'bitbucket-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configuration initiale à partir des variables d'environnement
    this.config = {
      baseUrl: process.env.BITBUCKET_URL || '',
      token: process.env.BITBUCKET_TOKEN,
      username: process.env.BITBUCKET_USERNAME,
      password: process.env.BITBUCKET_PASSWORD,
      project: process.env.BITBUCKET_PROJECT || '',
      repository: process.env.BITBUCKET_REPOSITORY || ''
    };

    if (!this.config.baseUrl) {
      throw new Error('BITBUCKET_URL is required');
    }

    if (!this.config.token && !(this.config.username && this.config.password)) {
      throw new Error('Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required');
    }

    // Configuration de l'instance Axios
    this.api = axios.create({
      baseURL: `${this.config.baseUrl}/rest/api/1.0`,
      headers: this.config.token 
        ? { Authorization: `Bearer ${this.config.token}` }
        : {},
      auth: this.config.username && this.config.password
        ? { username: this.config.username, password: this.config.password }
        : undefined,
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error) => logger.error('[MCP Error]', error);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_pull_request',
          description: 'Create a new pull request',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'PR title' },
              description: { type: 'string', description: 'PR description' },
              sourceBranch: { type: 'string', description: 'Source branch name' },
              targetBranch: { type: 'string', description: 'Target branch name' },
              reviewers: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'List of reviewer usernames'
              }
            },
            required: ['title', 'sourceBranch', 'targetBranch']
          }
        },
        {
          name: 'get_pull_request',
          description: 'Get pull request details',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' }
            },
            required: ['prId']
          }
        },
        {
          name: 'merge_pull_request',
          description: 'Merge a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' },
              message: { type: 'string', description: 'Merge commit message' },
              strategy: { 
                type: 'string', 
                enum: ['merge-commit', 'squash', 'fast-forward'],
                description: 'Merge strategy to use'
              }
            },
            required: ['prId']
          }
        },
        {
          name: 'decline_pull_request',
          description: 'Decline a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' },
              message: { type: 'string', description: 'Reason for declining' }
            },
            required: ['prId']
          }
        },
        {
          name: 'add_comment',
          description: 'Add a comment to a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' },
              text: { type: 'string', description: 'Comment text' },
              parentId: { type: 'number', description: 'Parent comment ID for replies' }
            },
            required: ['prId', 'text']
          }
        },
        {
          name: 'get_diff',
          description: 'Get pull request diff',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' },
              contextLines: { type: 'number', description: 'Number of context lines' }
            },
            required: ['prId']
          }
        },
        {
          name: 'get_reviews',
          description: 'Get pull request reviews',
          inputSchema: {
            type: 'object',
            properties: {
              prId: { type: 'number', description: 'Pull request ID' }
            },
            required: ['prId']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        logger.info(`Called tool: ${request.params.name}`, { arguments: request.params.arguments });

        switch (request.params.name) {
          case 'create_pull_request':
            return await this.createPullRequest(request.params.arguments as PullRequestInput);
          case 'get_pull_request':
            return await this.getPullRequest(request.params.arguments.prId);
          case 'merge_pull_request':
            return await this.mergePullRequest(
              request.params.arguments.prId,
              request.params.arguments.message,
              request.params.arguments.strategy
            );
          case 'decline_pull_request':
            return await this.declinePullRequest(
              request.params.arguments.prId,
              request.params.arguments.message
            );
          case 'add_comment':
            return await this.addComment(
              request.params.arguments.prId,
              request.params.arguments.text,
              request.params.arguments.parentId
            );
          case 'get_diff':
            return await this.getDiff(
              request.params.arguments.prId,
              request.params.arguments.contextLines
            );
          case 'get_reviews':
            return await this.getReviews(request.params.arguments.prId);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        logger.error('Tool execution error', { error });
        if (axios.isAxiosError(error)) {
          throw new McpError(
            ErrorCode.InternalError,
            `Bitbucket API error: ${error.response?.data.message ?? error.message}`
          );
        }
        throw error;
      }
    });
  }

  private async createPullRequest(input: PullRequestInput) {
    const response = await this.api.post(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests`,
      {
        title: input.title,
        description: input.description,
        fromRef: {
          id: `refs/heads/${input.sourceBranch}`,
          repository: {
            slug: this.config.repository,
            project: { key: this.config.project }
          }
        },
        toRef: {
          id: `refs/heads/${input.targetBranch}`,
          repository: {
            slug: this.config.repository,
            project: { key: this.config.project }
          }
        },
        reviewers: input.reviewers?.map(username => ({ user: { name: username } }))
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getPullRequest(prId: number) {
    const response = await this.api.get(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}`
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async mergePullRequest(prId: number, message?: string, strategy: string = 'merge-commit') {
    const response = await this.api.post(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}/merge`,
      {
        version: -1,
        message: message,
        strategy
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async declinePullRequest(prId: number, message?: string) {
    const response = await this.api.post(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}/decline`,
      {
        version: -1,
        message: message
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async addComment(prId: number, text: string, parentId?: number) {
    const response = await this.api.post(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}/comments`,
      {
        text: text,
        parent: parentId ? { id: parentId } : undefined
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getDiff(prId: number, contextLines: number = 10) {
    const response = await this.api.get(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}/diff`,
      {
        params: { contextLines },
        headers: { Accept: 'text/plain' }
      }
    );

    return {
      content: [{ type: 'text', text: response.data }]
    };
  }

  private async getReviews(prId: number) {
    const response = await this.api.get(
      `/projects/${this.config.project}/repos/${this.config.repository}/pull-requests/${prId}/activities`
    );

    const reviews = response.data.values.filter(
      (activity: any) => activity.action === 'APPROVED' || activity.action === 'REVIEWED'
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Bitbucket MCP server running on stdio');
  }
}

const server = new BitbucketServer();
server.run().catch((error) => {
  logger.error('Server error', error);
  process.exit(1);
});