#include <stdio.h>
#include <stdlib.h>
#include "header.h"
//Linked List struct, for future use.
typedef struct Node {
    struct Node *next;
    int data;
}node_t;

//Need to allocate memory to the array in order to its data outside of the function.
int* int_array(int size){

    int ex[9] = {1,2,3,4,5,6,7,8};
    
    int* dynamic_array = (int *) malloc(size * sizeof(int));
    
    for (int i = 0; i < 4; i++){
        dynamic_array[i] = i;
    }
    


    return dynamic_array;
}


//Functions used to experiment with the call stack.
int compute_sum(int a, int b) {
    int sum = a + b;
    int x;
    printf("Compute: %d \n", 3);
    return sum;
}

int compute_product(int a, int b) {
    int r;
    int product = a * b;
    return product;
}

void print_result(int sum, int product) {
    printf("Sum: %d\n", sum);
    printf("Product: %d\n", product);
}

int main() {

    int x = 6;
    int y = 3;

    int *m = (int *) malloc(31);

    m = &y;


    //int sum = compute_sum(x, y);
    //int product = compute_product(x, y);

    int *a = &x;

    
    int *example_arr = int_array(4);

    int z = x + y;

    printf("Out of bounds \n");
    header_print();
    free(example_arr);
    return 0;
}