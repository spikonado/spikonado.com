export interface BillingPlan {
	id: string;
	title: string;
	description: string;
	highlight?: boolean;
	currency?: string;
	monthlyPrice: string;
	monthlyCurrency?: string;
	yearlyPrice: string;
	yearlyCurrency?: string;
	buttonText: string;
	badge?: string;
	features: Array<{
		name: string;
		icon: string;
		iconColor?: string;
	}>;
}
