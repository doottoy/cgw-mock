export function makeStubKey(route: string, endpoint: string, method: string): string {
    return `stub:${route}:${endpoint}:${method}`;
}

export function makeHistoryKey(route: string, endpoint: string): string {
    return `history:${route}:${endpoint}}`;
}
