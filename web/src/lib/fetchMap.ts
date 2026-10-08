import type { Map } from "@/types/map.type";

export const fetchMap = async (circuitKey: number): Promise<Map | null> => {
	try {
		const year = new Date().getFullYear();

		const mapRequest = await fetch(`https://api.multiviewer.app/api/v1/circuits/${circuitKey}/${year}`);

		if (!mapRequest.ok) {
			console.error("Failed to fetch map", mapRequest);
			return null;
		}

		return mapRequest.json();
	} catch (error) {
		console.error("Failed to fetch map", error);
		return null;
	}
};
