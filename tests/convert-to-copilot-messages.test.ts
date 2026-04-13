import { describe, it, expect } from 'vitest';
import { convertToCopilotMessages } from '../src/conversion/convert-to-copilot-messages';

describe('convertToCopilotMessages', () => {
  it('should convert a simple user message', () => {
    const result = convertToCopilotMessages([
      { role: 'user', content: 'Hello world' }
    ]);
    expect(result.prompt).toBe('User: Hello world');
    expect(result.systemMessage).toBeUndefined();
  });

  it('should convert a system message', () => {
    const result = convertToCopilotMessages([
      { role: 'system', content: 'You are helpful.' }
    ]);
    expect(result.prompt).toBe('System: You are helpful.');
    expect(result.systemMessage).toBe('You are helpful.');
  });

  it('should convert an assistant message', () => {
    const result = convertToCopilotMessages([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]);
    expect(result.prompt).toBe('User: Hello\n\nAssistant: Hi there!');
  });

  it('should extract text from part content', () => {
    const result = convertToCopilotMessages([
      { role: 'user', content: [{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }] }
    ]);
    expect(result.prompt).toBe('User: Part 1\nPart 2');
  });

  it('should handle multiple messages in sequence', () => {
    const result = convertToCopilotMessages([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'It is 4.' },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'calculator', output: { type: 'text', value: '4' } }] }
    ]);
    expect(result.prompt).toBe(
      'System: You are a helpful assistant.\n\nUser: What is 2+2?\n\nAssistant: It is 4.\n\nTool result (calculator): 4'
    );
  });

  it('should warn on image parts', () => {
    const result = convertToCopilotMessages([
      { role: 'user', content: [{ type: 'image', image: new Uint8Array([1, 2, 3]) }] }
    ]);
    expect(result.warnings).toContain(
      'Base64/image data URLs require file paths. Write to temp file and pass path, or use attachments with path.'
    );
  });
});
