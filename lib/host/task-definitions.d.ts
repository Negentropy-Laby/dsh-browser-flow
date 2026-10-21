/** @param {unknown} value - origin list. @returns {value is string[]} exact HTTP(S) origins. */
export function validOrigins(value: unknown): value is string[];
/** @param {unknown} raw - durable declaration. @returns {Definition} validated local data, never executable modules. */
export function validateDefinition(raw: unknown): Definition;
/** @param {string} configured - absolute config or empty. @param {Profile | undefined} profile - actual dsh profile. @returns {string | undefined} root independent of CWD and package location. */
export function tasksRoot(configured: string, profile: Profile | undefined): string | undefined;
/** @param {string} root - local root. @param {string} path - descendant. @returns {void} reject links in every existing component. */
export function noLinks(root: string, path: string): void;
/** @param {string} root - task root. @param {string} id - directory identifier. @param {string} [expectedId] - immutable snapshot definition identity. @returns {DefinitionSnapshot} stable exact content for a new task. */
export function loadDefinition(root: string, id: string, expectedId?: string): DefinitionSnapshot;
/** @param {string | undefined} root - optional local directory. @param {(id: string) => void} [invalid] - sanitized invalid-entry notice. @returns {DefinitionSnapshot[]} available definitions; absence is normal. */
export function listDefinitions(root: string | undefined, invalid?: (id: string) => void): DefinitionSnapshot[];
/** @param {DefinitionSnapshot} snapshot - validated snapshot. @returns {LocalSkill[]} optional user-only entrypoints; task instructions must be read from the bound task view. */
export function definitionSkills(snapshot: DefinitionSnapshot): LocalSkill[];
export function localId(value: unknown): value is string;
export type Workflow = {
    id: string;
    skill: string;
    description: string;
    instructions: string[];
    resources: string[];
    stopBoundary: string;
};
export type Definition = {
    schemaVersion: 1;
    id: string;
    version: string;
    adapter: string;
    adapterVersion: number;
    origins: string[];
    resources: string[];
    workflows: Workflow[];
};
export type DefinitionSnapshot = {
    definition: Definition;
    files: Record<string, string>;
    digest: string;
};
export type LocalSkill = {
    name: string;
    description: string;
    source: "runtime";
    invocation: {
        modelInvocable: false;
        userInvocable: true;
    };
    content: string;
};
export type Profile = {
    name: string;
    home: string;
};
