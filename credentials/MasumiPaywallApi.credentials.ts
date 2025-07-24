import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MasumiPaywallApi implements ICredentialType {
	name = 'masumiPaywallApi';

	displayName = 'Masumi Paywall API';

	documentationUrl = 'https://docs.masumi.org/api';

	properties: INodeProperties[] = [
		{
			displayName: 'Payment Service URL',
			name: 'paymentServiceUrl',
			type: 'string',
			default: 'https://your-masumi-service.railway.app/api/v1',
			required: true,
			description: 'The base URL of your Masumi payment service',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your Masumi API key for authentication',
		},
		{
			displayName: 'Agent Identifier',
			name: 'agentIdentifier',
			type: 'string',
			default: '',
			required: true,
			description: 'Unique identifier for your payment agent',
		},
		{
			displayName: 'Seller Verification Key',
			name: 'sellerVkey',
			type: 'string',
			default: '',
			required: true,
			description: 'Cardano wallet verification key for the seller',
		},
		{
			displayName: 'Network',
			name: 'network',
			type: 'options',
			options: [
				{
					name: 'Preprod (Testnet)',
					value: 'Preprod',
				},
				{
					name: 'Mainnet',
					value: 'Mainnet',
				},
			],
			default: 'Preprod',
			required: true,
			description: 'Cardano network to use for payments',
		},
	];
}