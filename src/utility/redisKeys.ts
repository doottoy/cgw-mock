export function makeStubKey(route: string, endpoint: string, method: string): string {
    return `stub:${route}:${endpoint}:${method}`;
}
