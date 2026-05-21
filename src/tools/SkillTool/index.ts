import type { Skill } from '../../skill/skill.ts'
import { registerTool } from '../registry.ts'
import { createSkillToolWithAgent, TOOL_DEFAULT_PERMISSION } from './SkillTool.ts'

export function registerSkillTool(getSkills: () => Skill[]): void {
  registerTool({
    name: 'skill',
    defaultPermission: TOOL_DEFAULT_PERMISSION,
    createTool: () => createSkillToolWithAgent({ getSkills }),
    formatDescription: (input) =>
      typeof input.skill === 'string' ? `skill ${input.skill}` : '(unknown skill)',
    extractMatchContent: (input) =>
      typeof input.skill === 'string' ? input.skill : undefined,
  })
}
