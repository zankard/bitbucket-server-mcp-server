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

interface BitbucketActivity {
  action: string;
  [key: string]: unknown;
}

interface BitbucketConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

interface RepositoryParams {
  project: string;
  repository: string;
}

interface PullRequestParams extends RepositoryParams {
  prId: number;
}

interface MergeOptions {
  message?: string;
  strategy?: 'merge-commit' | 'squash' | 'fast-forward';
}

interface CommentOptions {
  text: string;
  parentId?: number;
}

interface PullRequestInput extends RepositoryParams {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
}

class BitbucketServer {
  private readonly server: Server;
  private readonly api: AxiosInstance;
  private readonly config: BitbucketConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'bitbucket-server-mcp-server',
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
      baseUrl: process.env.BITBUCKET_URL ?? '',
      token: process.env.BITBUCKET_TOKEN,
      username: process.env.BITBUCKET_USERNAME,
      password: process.env.BITBUCKET_PASSWORD
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

  private isPullRequestInput(args: unknown): args is PullRequestInput {
    const input = args as Partial<PullRequestInput>;
    return typeof args === 'object' &&
      args !== null &&
      typeof input.project === 'string' &&
      typeof input.repository === 'string' &&
      typeof input.title === 'string' &&
      typeof input.sourceBranch === 'string' &&
      typeof input.targetBranch === 'string' &&
      (input.description === undefined || typeof input.description === 'string') &&
      (input.reviewers === undefined || Array.isArray(input.reviewers));
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
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
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
            required: ['project', 'repository', 'title', 'sourceBranch', 'targetBranch']
          }
        },
        {
          name: 'get_pull_request',
          description: 'Get pull request details',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' }
            },
            required: ['project', 'repository', 'prId']
          }
        },
        {
          name: 'merge_pull_request',
          description: 'Merge a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' },
              message: { type: 'string', description: 'Merge commit message' },
              strategy: {
                type: 'string',
                enum: ['merge-commit', 'squash', 'fast-forward'],
                description: 'Merge strategy to use'
              }
            },
            required: ['project', 'repository', 'prId']
          }
        },
        {
          name: 'decline_pull_request',
          description: 'Decline a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' },
              message: { type: 'string', description: 'Reason for declining' }
            },
            required: ['project', 'repository', 'prId']
          }
        },
        {
          name: 'add_comment',
          description: 'Add a comment to a pull request',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' },
              text: { type: 'string', description: 'Comment text' },
              parentId: { type: 'number', description: 'Parent comment ID for replies' }
            },
            required: ['project', 'repository', 'prId', 'text']
          }
        },
        {
          name: 'get_diff',
          description: 'Get pull request diff',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' },
              contextLines: { type: 'number', description: 'Number of context lines' }
            },
            required: ['project', 'repository', 'prId']
          }
        },
        {
          name: 'get_reviews',
          description: 'Get pull request reviews',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key' },
              repository: { type: 'string', description: 'Repository slug' },
              prId: { type: 'number', description: 'Pull request ID' }
            },
            required: ['project', 'repository', 'prId']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        logger.info(`Called tool: ${request.params.name}`, { arguments: request.params.arguments });
        const args = request.params.arguments ?? {};

        const pullRequestParams: PullRequestParams = {
          project: args.project as string,
          repository: args.repository as string,
          prId: args.prId as number
        };

        switch (request.params.name) {
          case 'create_pull_request':
            if (!this.isPullRequestInput(args)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Invalid pull request input parameters'
              );
            }
            return await this.createPullRequest(args);
          case 'get_pull_request':
            return await this.getPullRequest(pullRequestParams);
          case 'merge_pull_request':
            return await this.mergePullRequest(pullRequestParams, {
              message: args.message as string,
              strategy: args.strategy as 'merge-commit' | 'squash' | 'fast-forward'
            });
          case 'decline_pull_request':
            return await this.declinePullRequest(pullRequestParams, args.message as string);
          case 'add_comment':
            return await this.addComment(pullRequestParams, {
              text: args.text as string,
              parentId: args.parentId as number
            });
          case 'get_diff':
            return await this.getDiff(pullRequestParams, args.contextLines as number);
          case 'get_reviews':
            return await this.getReviews(pullRequestParams);
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
      `/projects/${input.project}/repos/${input.repository}/pull-requests`,
      {
        title: input.title,
        description: input.description,
        fromRef: {
          id: `refs/heads/${input.sourceBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project }
          }
        },
        toRef: {
          id: `refs/heads/${input.targetBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project }
          }
        },
        reviewers: input.reviewers?.map(username => ({ user: { name: username } }))
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getPullRequest(params: PullRequestParams) {
    const { project, repository, prId } = params;
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}`
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async mergePullRequest(params: PullRequestParams, options: MergeOptions = {}) {
    const { project, repository, prId } = params;
    const { message, strategy = 'merge-commit' } = options;
    
    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/merge`,
      {
        version: -1,
        message,
        strategy
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async declinePullRequest(params: PullRequestParams, message?: string) {
    const { project, repository, prId } = params;
    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/decline`,
      {
        version: -1,
        message
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async addComment(params: PullRequestParams, options: CommentOptions) {
    const { project, repository, prId } = params;
    const { text, parentId } = options;
    
    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/comments`,
      {
        text,
        parent: parentId ? { id: parentId } : undefined
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getDiff(params: PullRequestParams, contextLines: number = 10) {
    const { project, repository, prId } = params;
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/diff`,
      {
        params: { contextLines },
        headers: { Accept: 'text/plain' }
      }
    );

    return {
      content: [{ type: 'text', text: response.data }]
    };
  }

  private async getReviews(params: PullRequestParams) {
    const { project, repository, prId } = params;
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`
    );

    const reviews = response.data.values.filter(
      (activity: BitbucketActivity) => activity.action === 'APPROVED' || activity.action === 'REVIEWED'
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