import { describe, expect, it } from 'vitest';
import { widgetScriptUrl } from './AssistantWidget';

describe('assistant widget release URL', () => {
  it('uses a versioned URL so an existing browser cache does not retain the prior widget', () => {
    expect(widgetScriptUrl('')).toBe('/widget.js?v=assistant20261028a');
    expect(widgetScriptUrl('https://api.earthorafarms.com'))
      .toBe('https://api.earthorafarms.com/widget.js?v=assistant20261028a');
  });
});
