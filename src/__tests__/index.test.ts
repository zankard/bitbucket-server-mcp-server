import { jest } from '@jest/globals';

// Mock axios before any imports
jest.mock('axios');

// Mock MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');

import axios from 'axios';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  McpError, 
  ErrorCode 
} from '@modelcontextprotocol/sdk/types.js';

// Mock axios instance
const mockAxiosInstance = {
  get: jest.fn() as jest.MockedFunction<any>,
  post: jest.fn() as jest.MockedFunction<any>,
  put: jest.fn() as jest.MockedFunction<any>,
  delete: jest.fn() as jest.MockedFunction<any>,
  defaults: {
    baseURL: '',
    headers: {}
  }
} as any;

// Mock axios
const mockAxios = axios as jest.Mocked<typeof axios>;
mockAxios.create = jest.fn().mockReturnValue(mockAxiosInstance) as any;
mockAxios.isAxiosError = jest.fn() as any;

// Mock MCP Server
const mockServer = {
  setRequestHandler: jest.fn(),
  connect: jest.fn(),
  close: jest.fn(),
  onerror: null as any
} as any;

const MockServer = Server as jest.MockedClass<typeof Server>;
MockServer.mockImplementation(() => mockServer as any);

// Mock StdioServerTransport
const mockTransport = {};
const MockStdioServerTransport = StdioServerTransport as jest.MockedClass<typeof StdioServerTransport>;
MockStdioServerTransport.mockImplementation(() => mockTransport as any);

// Import the BitbucketServer class for testing
import { BitbucketServer } from '../index.js';

describe('Bitbucket Server MCP', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let server: any;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set up test environment
    process.env = {
      ...originalEnv,
      BITBUCKET_URL: 'https://bitbucket.example.com',
      BITBUCKET_TOKEN: 'test-token',
      BITBUCKET_DEFAULT_PROJECT: 'TEST'
    };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Configuration and Initialization', () => {
    test('should throw error when BITBUCKET_URL is missing', () => {
      delete process.env.BITBUCKET_URL;
      
      expect(() => {
        new BitbucketServer();
      }).toThrow('BITBUCKET_URL is required');
    });

    test('should throw error when authentication is missing', () => {
      delete process.env.BITBUCKET_TOKEN;
      delete process.env.BITBUCKET_USERNAME;
      delete process.env.BITBUCKET_PASSWORD;
      
      expect(() => {
        new BitbucketServer();
      }).toThrow('Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required');
    });

    test('should configure axios with token authentication', () => {
      server = new BitbucketServer();
      
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://bitbucket.example.com/rest/api/1.0',
        headers: { Authorization: 'Bearer test-token' },
        auth: undefined
      });
    });

    test('should configure axios with username/password authentication', () => {
      delete process.env.BITBUCKET_TOKEN;
      process.env.BITBUCKET_USERNAME = 'testuser';
      process.env.BITBUCKET_PASSWORD = 'testpass';
      
      server = new BitbucketServer();
      
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://bitbucket.example.com/rest/api/1.0',
        headers: {},
        auth: { username: 'testuser', password: 'testpass' }
      });
    });

    test('should register all expected tools', () => {
      server = new BitbucketServer();
      
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema, 
        expect.any(Function)
      );
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        CallToolRequestSchema, 
        expect.any(Function)
      );
    });
  });

  describe('Tool Registration', () => {
    test('should register correct tools with schemas', async () => {
      server = new BitbucketServer();
      
      // Get the ListTools handler
      const listToolsCall = mockServer.setRequestHandler.mock.calls.find(
        (call: any) => call[0] === ListToolsRequestSchema
      );
      
      expect(listToolsCall).toBeDefined();
      const listToolsHandler = listToolsCall![1] as any;
      
      // Call the handler
      const result = await listToolsHandler();
      
      expect(result.tools).toHaveLength(9);
      
      const toolNames = result.tools.map((tool: any) => tool.name);
      expect(toolNames).toEqual([
        'list_projects',
        'list_repositories', 
        'create_pull_request',
        'get_pull_request',
        'merge_pull_request',
        'decline_pull_request',
        'add_comment',
        'get_diff',
        'get_reviews'
      ]);
    });
  });

  describe('API Operations', () => {
    let callToolHandler: any;

    beforeEach(() => {
      server = new BitbucketServer();
      
      // Get the CallTool handler
      const callToolCall = mockServer.setRequestHandler.mock.calls.find(
        (call: any) => call[0] === CallToolRequestSchema
      );
      callToolHandler = callToolCall![1];
    });

    describe('list_projects', () => {
      test('should list projects with pagination', async () => {
        const mockProjects = {
          values: [
            { key: 'PROJ1', name: 'Project 1', description: 'Test project', public: false, type: 'NORMAL' },
            { key: 'PROJ2', name: 'Project 2', description: 'Another project', public: true, type: 'NORMAL' }
          ],
          size: 2
        };
        
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockProjects });

        const result = await callToolHandler({
          params: {
            name: 'list_projects',
            arguments: { limit: 10, start: 0 }
          }
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', {
          params: { limit: 10, start: 0 }
        });
        
        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.total).toBe(2);
        expect(responseData.projects).toHaveLength(2);
        expect(responseData.projects[0].key).toBe('PROJ1');
      });
    });

    describe('list_repositories', () => {
      test('should list repositories for specific project', async () => {
        const mockRepos = {
          values: [
            { 
              slug: 'repo1', 
              name: 'Repository 1', 
              project: { key: 'TEST' },
              public: false,
              state: 'AVAILABLE',
              links: {
                clone: [{ name: 'http', href: 'https://bitbucket.example.com/scm/test/repo1.git' }]
              }
            }
          ],
          size: 1
        };
        
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockRepos });

        const result = await callToolHandler({
          params: {
            name: 'list_repositories',
            arguments: { project: 'TEST', limit: 25, start: 0 }
          }
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/TEST/repos', {
          params: { limit: 25, start: 0 }
        });
        
        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.project).toBe('TEST');
        expect(responseData.repositories).toHaveLength(1);
        expect(responseData.repositories[0].slug).toBe('repo1');
      });

      test('should list all repositories when no project specified', async () => {
        const mockRepos = {
          values: [
            { 
              slug: 'repo1', 
              name: 'Repository 1', 
              project: { key: 'PROJ1' },
              public: false,
              state: 'AVAILABLE'
            }
          ],
          size: 1
        };
        
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockRepos });

        const result = await callToolHandler({
          params: {
            name: 'list_repositories',
            arguments: { limit: 25, start: 0 }
          }
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/TEST/repos', {
          params: { limit: 25, start: 0 }
        });
      });
    });

    describe('create_pull_request', () => {
      test('should create pull request with all parameters', async () => {
        const mockPR = { id: 123, title: 'Test PR', state: 'OPEN' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockPR });

        const result = await callToolHandler({
          params: {
            name: 'create_pull_request',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              title: 'Test PR',
              description: 'Test description',
              sourceBranch: 'feature/test',
              targetBranch: 'main',
              reviewers: ['user1', 'user2']
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests',
          expect.objectContaining({
            title: 'Test PR',
            description: 'Test description',
            fromRef: expect.objectContaining({
              id: 'refs/heads/feature/test'
            }),
            toRef: expect.objectContaining({
              id: 'refs/heads/main'
            }),
            reviewers: [
              { user: { name: 'user1' } },
              { user: { name: 'user2' } }
            ]
          })
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.id).toBe(123);
      });

      test('should use default project when not specified', async () => {
        const mockPR = { id: 124, title: 'Test PR 2', state: 'OPEN' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockPR });

        const result = await callToolHandler({
          params: {
            name: 'create_pull_request',
            arguments: {
              repository: 'repo1',
              title: 'Test PR 2',
              sourceBranch: 'feature/test2',
              targetBranch: 'main'
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests',
          expect.anything()
        );
      });

      test('should throw error when no project available', async () => {
        // Create a new server instance without default project
        const originalDefault = process.env.BITBUCKET_DEFAULT_PROJECT;
        delete process.env.BITBUCKET_DEFAULT_PROJECT;
        
        // Reset mocks to get clean state
        jest.clearAllMocks();
        
        try {
          const newServer = new BitbucketServer();
          
          // Get the new handler
          const newCallToolCall = mockServer.setRequestHandler.mock.calls.find(
            (call: any) => call[0] === CallToolRequestSchema
          );
          const newCallToolHandler = newCallToolCall![1] as any;

          await expect(newCallToolHandler({
            params: {
              name: 'create_pull_request',
              arguments: {
                repository: 'repo1',
                title: 'Test PR',
                sourceBranch: 'feature/test',
                targetBranch: 'main'
              }
            }
          })).rejects.toThrow('Project must be provided either as a parameter or through BITBUCKET_DEFAULT_PROJECT environment variable');
        } finally {
          // Restore the default project
          if (originalDefault) {
            process.env.BITBUCKET_DEFAULT_PROJECT = originalDefault;
          }
        }
      });
    });

    describe('add_comment', () => {
      test('should add general comment', async () => {
        const mockComment = { id: 456, text: 'Test comment' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockComment });

        const result = await callToolHandler({
          params: {
            name: 'add_comment',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              text: 'Test comment'
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123/comments',
          {
            text: 'Test comment',
            parent: undefined
          }
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.id).toBe(456);
      });

      test('should add threaded comment', async () => {
        const mockComment = { id: 457, text: 'Reply comment' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockComment });

        const result = await callToolHandler({
          params: {
            name: 'add_comment',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              text: 'Reply comment',
              parentId: 456
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123/comments',
          {
            text: 'Reply comment',
            parent: { id: 456 }
          }
        );
      });

      test('should add file line comment', async () => {
        const mockComment = { id: 458, text: 'Line comment' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockComment });

        const result = await callToolHandler({
          params: {
            name: 'add_comment',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              text: 'Line comment',
              filePath: 'src/index.ts',
              lineNumber: 42,
              lineType: 'ADDED',
              fileType: 'TO',
              diffType: 'EFFECTIVE'
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123/comments',
          {
            text: 'Line comment',
            parent: undefined,
            anchor: {
              diffType: 'EFFECTIVE',
              line: 42,
              lineType: 'ADDED',
              fileType: 'TO',
              path: 'src/index.ts',
              srcPath: 'src/index.ts'
            }
          }
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.id).toBe(458);
      });

      test('should add file line comment with commit hashes', async () => {
        const mockComment = { id: 459, text: 'Line comment with hashes' };
        mockAxiosInstance.post.mockResolvedValueOnce({ data: mockComment });

        const result = await callToolHandler({
          params: {
            name: 'add_comment',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              text: 'Line comment with hashes',
              filePath: 'src/utils.ts',
              lineNumber: 15,
              lineType: 'REMOVED',
              fileType: 'FROM',
              diffType: 'COMMIT',
              fromHash: 'abc123',
              toHash: 'def456'
            }
          }
        });

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123/comments',
          {
            text: 'Line comment with hashes',
            parent: undefined,
            anchor: {
              diffType: 'COMMIT',
              line: 15,
              lineType: 'REMOVED',
              fileType: 'FROM',
              path: 'src/utils.ts',
              srcPath: 'src/utils.ts',
              fromHash: 'abc123',
              toHash: 'def456'
            }
          }
        );
      });

      test('should throw error when lineNumber missing for file comment', async () => {
        await expect(callToolHandler({
          params: {
            name: 'add_comment',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              text: 'Invalid file comment',
              filePath: 'src/index.ts'
              // Missing lineNumber
            }
          }
        })).rejects.toThrow(McpError);
      });
    });

    describe('get_pull_request', () => {
      test('should get pull request details', async () => {
        const mockPR = { 
          id: 123, 
          title: 'Test PR', 
          state: 'OPEN',
          author: { name: 'author1' }
        };
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockPR });

        const result = await callToolHandler({
          params: {
            name: 'get_pull_request',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123
            }
          }
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123'
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.id).toBe(123);
        expect(responseData.title).toBe('Test PR');
      });
    });

    describe('get_diff', () => {
      test('should get pull request diff', async () => {
        const mockDiff = 'diff --git a/file.txt b/file.txt\nindex 123..456\n+++ b/file.txt\n@@ -1,1 +1,2 @@\n line1\n+line2';
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockDiff });

        const result = await callToolHandler({
          params: {
            name: 'get_diff',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123,
              contextLines: 5
            }
          }
        });

        expect(mockAxiosInstance.get).toHaveBeenCalledWith(
          '/projects/TEST/repos/repo1/pull-requests/123/diff',
          {
            params: { contextLines: 5 },
            headers: { Accept: 'text/plain' }
          }
        );

        expect(result.content[0].text).toBe(mockDiff);
      });
    });

    describe('Error Handling', () => {
      test('should handle axios errors', async () => {
        const axiosError = {
          response: {
            data: { message: 'API Error' }
          }
        };
        
        mockAxios.isAxiosError.mockReturnValue(true);
        mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

        await expect(callToolHandler({
          params: {
            name: 'get_pull_request',
            arguments: {
              project: 'TEST',
              repository: 'repo1',
              prId: 123
            }
          }
        })).rejects.toThrow('Bitbucket API error: API Error');
      });

      test('should handle unknown tool', async () => {
        await expect(callToolHandler({
          params: {
            name: 'unknown_tool',
            arguments: {}
          }
        })).rejects.toThrow('Unknown tool: unknown_tool');
      });
    });
  });
});