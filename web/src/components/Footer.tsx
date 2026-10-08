import Link from "@/compat/link";

export default function Footer() {
	return (
		<footer className="my-8 text-sm text-zinc-500">
			<p className="mb-4">
				<Link className="text-blue-500" href="/help">
					Help
				</Link>
			</p>
			<p>
				This project is unofficial and is not associated with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA
				FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trademarks of Formula One Licensing B.V.
			</p>
		</footer>
	);
}
