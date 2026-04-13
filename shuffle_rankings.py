import random

def shuffle_csv(input_file, output_file):
    with open(input_file, 'r') as f:
        lines = f.readlines()
    
    header = lines[0]
    data = lines[1:]
    
    # Simple shuffle to create a different board
    random.shuffle(data)
    
    with open(output_file, 'w') as f:
        f.write(header)
        f.writelines(data)

if __name__ == "__main__":
    shuffle_csv('public/rankings.csv', 'public/rankings_dan.csv')
    shuffle_csv('public/rankings.csv', 'public/rankings_ryan.csv')
    print("Generated rankings_dan.csv and rankings_ryan.csv")
