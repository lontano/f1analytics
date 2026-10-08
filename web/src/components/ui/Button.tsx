"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import clsx from "clsx";

type Props = {
	children: ReactNode;
	onClick?: () => void;
	className?: string;
	disabled?: boolean;
};

export default function Button({ children, onClick, className, disabled }: Props) {
	return (
		<motion.button
			whileHover={disabled ? undefined : { scale: 1.05 }}
			whileTap={disabled ? undefined : { scale: 0.95 }}
			className={clsx(
				className,
				"rounded-lg p-2 text-center leading-none text-white",
				disabled ? "cursor-not-allowed bg-zinc-900 text-zinc-500" : "cursor-pointer bg-zinc-800",
			)}
			onClick={onClick}
			disabled={disabled}
		>
			{children}
		</motion.button>
	);
}
