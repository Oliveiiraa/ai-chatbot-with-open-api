import { CreateMessage, JSONValue, ToolCallPayload } from 'ai';
import { OpenAI } from 'openai';
import { ChatCompletionChunk } from 'openai/resources';
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';

interface OpenAPISpec {
  servers: Array<{
    url: string
  }>
  paths: {
    [path: string]: {
      [method: string]: {
        summary?: string
        operationId: string
        requestBody?: OpenAPIRequestBody
        parameters?: OpenAPIParameter[]
      };
    };
  };
}

interface OpenAPIRequestBody {
  content?: {
    'application/json': {
      schema: {
        type: string;
        properties: {
          [name: string]: {
            type: string;
          };
        };
        required?: string[];
      };
    };
  };
}

interface OpenAPIParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema: {
    type: string;
    enum?: string[];
  };
}

interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: {
      type: string;
      properties: {
        [name: string]: {
          type: string;
          description?: string;
          enum?: string[];
        };
      };
      required?: string[];
    };
  };
}

type CreateFunctionCallMessages = (result?: {
  tool_call_id: string;
  function_name: string;
  tool_call_result: JSONValue;
} | undefined) => CreateMessage[]

export class OpenAIAPIRetrieval {
  openai: OpenAI;
  model: ChatCompletionCreateParamsBase['model']
  openAPISpec: OpenAPISpec;
  apiFunctions: { [key: string]: (parameters: any) => Promise<any> };

  constructor(config: {
    apiKey: string, 
    model: ChatCompletionCreateParamsBase['model']
    openAPISpec: OpenAPISpec
  }) {
    this.openai = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model
    this.openAPISpec = config.openAPISpec;
    this.apiFunctions = {}; // Inicializa apiFunctions como um objeto vazio
  }

  private convertToTools(): ChatCompletionTool[] {
    console.log('Converting API operations to ChatCompletionTools');
    const tools: ChatCompletionTool[] = [];
    Object.keys(this.openAPISpec.paths).forEach((path) => {
      const methods = this.openAPISpec.paths[path];
      Object.keys(methods).forEach((method) => {
        const operation = methods[method];

        console.log(`Converting operation ${operation.operationId}`);
        
        tools.push({
          type: "function",
          function: {
            name: operation.operationId,
            description: operation.summary || '',
            parameters: {
              type: "object",
              properties: {
                ...this.convertParameters(operation.parameters).properties,
                ...this.convertRequestBody(operation.requestBody).properties
              },
              required: [
                ...this.convertParameters(operation.parameters).required,
                ...this.convertRequestBody(operation.requestBody).required
              ]
            },
          },
        });
      });
    });
    console.log(`Converted ${tools.length} tools`);
    return tools;
  }

  private convertParameters(parameters: OpenAPIParameter[] = []) {
    console.log('Converting parameters', parameters);
    
    const paramsSchema = {
      type: "object",
      properties: {},
      required: [],
    } as {
      type: "object",
      properties: any,
      required: any[]
    };

    parameters.forEach((param) => {
      console.log(`Converting parameter ${param.name}`);

      paramsSchema.properties[param.name] = {
        type: param.schema.type,
        description: param.description,
      };

      if (param.required) {
        paramsSchema.required.push(param.name);
      }

      if (param.schema.enum) {
        paramsSchema.properties[param.name].enum = param.schema.enum;
      }
    });

    console.log(`Converted ${parameters.length} parameters`);
    return paramsSchema;
  }

  private convertRequestBody(requestBody: OpenAPIRequestBody = {}) {
    console.log('Converting request body');
    
    const paramsSchema = {
      type: "object",
      properties: {},
      required: [],
    } as {
      type: "object",
      properties: any,
      required: any[]
    };

    if (requestBody?.content?.['application/json']) {
      const jsonSchema = requestBody.content['application/json'].schema;
      if (jsonSchema?.properties) {
        for (const [name, schema] of Object.entries(jsonSchema.properties)) {
          const propertySchema = schema as { type: string; enum?: string[] };
          paramsSchema.properties[name] = {
            type: propertySchema.type
          };
          if (jsonSchema.required?.includes(name)) {
            paramsSchema.required.push(name);
          }
          if (propertySchema.enum) {
            paramsSchema.properties[name].enum = propertySchema.enum;
          }
        }
      }
    }
    console.log('Request body converted');
    return paramsSchema;
  }

  private async callAPIFunction(operationId: string, parameters: any): Promise<any> {
    console.log(`Calling API function ${operationId}`);
  
    let functionDefinition;
    let pathKey;
    let methodKey;
  
    // Encontra a definição da função na especificação OpenAPI
    for (const path in this.openAPISpec.paths) {
      for (const method in this.openAPISpec.paths[path]) {
        if (this.openAPISpec.paths[path][method].operationId === operationId) {
          functionDefinition = this.openAPISpec.paths[path][method];
          pathKey = path;
          methodKey = method.toUpperCase();
          break;
        }
      }
      if (functionDefinition) break;
    }
  
    if (!functionDefinition) {
      throw new Error(`Function with operationId ${operationId} not found in OpenAPI spec.`);
    }
  
    // Constrói a URL e configura a chamada da API
    let url = this.openAPISpec.servers[0].url + pathKey;
    console.log(`Constructed URL: ${url}`);
  
    const options: RequestInit = {
      method: methodKey,
      headers: { 'Content-Type': 'application/json' },
    };
  
    if (methodKey !== 'GET') {
      // Se houver um requestBody, use-o como corpo da requisição
      if (functionDefinition.requestBody) {
        options.body = JSON.stringify(parameters);
      }
    } else if (parameters) {
      // Para métodos GET, adicione parâmetros na URL
      const queryParams = new URLSearchParams(parameters).toString();
      url += `?${queryParams}`;
    }
  
    console.log(`HTTP request options: ${JSON.stringify(options)}`);
    // Faz a chamada da API
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`API call to ${operationId} failed with status: ${response.status}`);
    }
  
    const jsonResponse = await response.json();
    console.log(`API response for ${operationId}: ${JSON.stringify(jsonResponse)}`);
    return jsonResponse;
  }

  init(): ChatCompletionTool[] {
    console.log('Initializing ChatCompletionTools');
    const tools = this.convertToTools();

    tools.forEach(tool => {
      console.log(`Initializing API function: ${tool.function.name}`);

      this.apiFunctions[tool.function.name] = async (parameters: any) => {
        return this.callAPIFunction(tool.function.name, parameters);
      };
    });
    
    console.log(`Initialized ${tools.length} ChatCompletionTools`);
    return tools;
  }

  async process({
    toolCall,
    messages,
    createFunctionCallMessages
  }: {
    toolCall: ToolCallPayload
    messages: any[],
    createFunctionCallMessages: CreateFunctionCallMessages
  }): Promise<Stream<ChatCompletionChunk> | undefined> {
    console.log('Processing response for function calls');
    const tool = toolCall.tools[0]
    
    const functionName = tool.func.name;
    const parameters = tool.func.arguments ? JSON.parse(tool.func.arguments as any) : {};
    
    if (this.apiFunctions[functionName]) {
      try {
        // Call the API function and get the response
        const apiResponse = await this.apiFunctions[functionName](parameters);
        console.log(`API response for ${functionName}: OK`);
    
        // Append the API response to the message content
        const newMessages = createFunctionCallMessages({
          function_name: tool.func.name,
          tool_call_id: tool.id,
          tool_call_result: apiResponse
        });
        
        return this.openai.chat.completions.create({
          messages: [...messages, ...newMessages],
          stream: true,
          model: this.model,
          temperature: 0.5
        });
      } catch (error: any) {
        console.error(`Error calling API function ${functionName}:`, error);
      }
    } else {
      console.error(`Function ${functionName} not found in API specification.`);
    }

    console.log('Finished processing response');
  }
}