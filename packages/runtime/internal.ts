export let unmapping: Record<string, URL | string> | undefined = undefined;

export function setUnmapping(newUnmapping: Record<string, URL | string>) {
	unmapping = newUnmapping;
}
