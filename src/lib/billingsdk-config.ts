export interface BillingPlan {
	id: string;
	title: string;
	description: string;
	highlight?: boolean;
	monthlyPrice: number | null;
	monthlyCurrency: string;
	yearlyPrice: number | null;
	yearlyCurrency: string;
	buttonText: string;
	badge?: string;
	features: Array<{ name: string }>;
}
