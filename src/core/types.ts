export type UUID = string & { readonly __uuid: unique symbol };

export type PortalDirection = "forward" | "backward" | "both";
export type EdgeType = "solid" | "portal" | "door";
export type EntityType = "PlayerSpawn" | "Enemy" | "Light" | "Prop";

export type Vec2 = [number, number];
