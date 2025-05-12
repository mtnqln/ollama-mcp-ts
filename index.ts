import {Message, Ollama, Tool} from 'ollama';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

dotenv.config();

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

class MCPClient {
    private mcp: Client;
    private ollama: Ollama;
    private transport: StdioClientTransport | null = null;
    private tools: Tool[] = [];

    constructor() {
        this.mcp = new Client({name:'mcp-client-cli',version:'1.0.0'});
        this.ollama = new Ollama({host:OLLAMA_URL});
    }

    async connectToServer(serverScriptPath: string) {
        try {
          const isJs = serverScriptPath.endsWith(".js");
          const isPy = serverScriptPath.endsWith(".py");
          if (!isJs && !isPy) {
            throw new Error("Server script must be a .js or .py file");
          }
          const command = isPy
            ? process.platform === "win32"
              ? "python"
              : "python3"
            : process.execPath;
      
          this.transport = new StdioClientTransport({
            command,
            args: [serverScriptPath],
          });
          this.mcp.connect(this.transport);
      
          const toolsResult = await this.mcp.listTools();
          this.tools = toolsResult.tools.map((tool) => {
            return {
                type: "function",
                function:{
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema.properties,
                }
            };
          });
          console.log(
            "Connected to server with tools:",this.tools.map((tool)=>
                tool.function.name));
        } catch (e) {
          console.log("Failed to connect to MCP server: ", e);
          throw e;
        }
    }

    async processQuery(query: string) {
        const messages: Message[] = [
          {
            role: "user",
            content: query,
          },
        ];
      
        const response = await this.ollama.chat({
            model: OLLAMA_MODEL,
            messages: messages,
            stream: false,
            tools:this.tools,
        })
        const finalText = [];
        const toolResults = [];
        if (response.message.tool_calls) {
            for (let content of response.message.tool_calls){

                const toolName = content.function.name;
                const toolArgs = content.function.arguments as { [x: string]: unknown } | undefined;
        
                const result = await this.mcp.callTool({
                name: toolName,
                arguments: toolArgs,
                });
                toolResults.push(result);
                finalText.push(
                `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
                );
                const arrayResult = result.content as any[];
                // turn the array of content‐elements into one big string:
                const flattened = arrayResult.map(item => {
                  switch (item.type) {
                    case 'text':
                      return item.text;
                    case 'resource':
                      return item.resource.data;      
                    default:
                      return '';
                  }
                }).join('\n\n');

                messages.push({
                  role: 'tool',
                  content: flattened, 
                });
        
                const response = await this.ollama.chat({
                model: OLLAMA_MODEL,
                messages,
                stream:false
                });
        
                finalText.push(
                    response.message.content ? response.message.content as string : ""
                );
            }
          
        } else {
            finalText.push(response.message.content);
        }
        return finalText.join("\n");
    }

    async chatLoop() {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
      
        try {
          console.log("\nMCP Client Started!");
          console.log("Type your queries or 'quit' to exit.");
      
          while (true) {
            const message = await rl.question("\nQuery: ");
            if (message.toLowerCase() === "quit") {
              break;
            }
            try {
            const response = await this.processQuery(message);
            console.log("\n Response :" + response);
            } catch (err) {
              console.log("Error occured : ",err)
            }
          }
        } finally {
          rl.close();
        }
      }
      
      async cleanup() {
        await this.mcp.close();
      }
}

async function main() {
    if (process.argv.length < 3) {
      console.log("Usage: node build/index.js ../mcp-server/build/index.js");
      return;
    }
    const mcpClient = new MCPClient();
    try {
      await mcpClient.connectToServer(process.argv[2]);
      await mcpClient.chatLoop();
    } finally {
      await mcpClient.cleanup();
      process.exit(0);
    }
  }
  
  main();
